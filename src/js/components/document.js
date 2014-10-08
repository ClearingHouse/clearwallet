function DocumentViewModel() {
  var self = this;

  self.myDocuments = ko.observableArray(null);
  self.myDocumentState = ko.observableArray(null);

  self.createDocumentTransfer = function(doc){
    self.documentTransferModal.show(doc.hash_string, doc.owner)
  }

  self.verifyDocument = function(doc){
    self.verifyDocumentModal.show()
  }

  self.displayDocumentState = function(data){

    docs = []
    for (var i in data) {
      var doc = {};
      doc['owner'] = data[i]['owner'];
      doc['hash_string'] = data[i]['hash_string']
      doc['description'] = data[i]['description']

      docs.push(doc)
    }

    $('#myDocumentStateTable').dataTable().fnClearTable();
    self.myDocumentState(docs);
    runDataTables('#myDocumentStateTable', true, {
      "aaSorting": [[3, 'desc']]
    });
  }

  self.displayDocuments = function(data) {
    docs = []
    for (var i in data) {
      var doc = {};
      doc['block_index'] = data[i]['block_index'];
      doc['address'] = data[i]['source'];
      doc['destination'] = data[i]['destination'];
      doc['hash_string'] = truncate(data[i]['hash_string'], 32)

      docs.push(doc)
    }

    $('#myDocumentTable').dataTable().fnClearTable();
    self.myDocuments(docs);
    runDataTables('#myDocumentTable', true, {
      "aaSorting": [[3, 'desc']]
    });
  }

  self.init = function() {
    self.documentTransferModal = new DocumentTransferModal()
    ko.applyBindings(self.documentTransferModal, document.getElementById("transferDocumentModal"));

    self.verifyDocumentModal = new VerifyDocumentModal()
    ko.applyBindings(self.verifyDocumentModal, document.getElementById("verifyDocumentModal"));

    failoverAPI('get_documents_for', {'addresses': WALLET.getAddressesList()}, self.displayDocuments);
    failoverAPI('get_document_state_for', {'addresses': WALLET.getAddressesList()}, self.displayDocumentState);
  }
}

function DocumentTransferModal() {
  var self = this;

  self.shown = ko.observable(false);
  self.documentHash = ko.observable("").extend({required: true});
  self.source = ko.observable("").extend({required: true});
  self.destination = ko.observable("").extend({required: true})
    .extend({
      validation: {
        validator: function(val, src) {
          return val != src();
        },
        message: i18n.t("notary_transfer_to_self"),
        params: self.source
      }
    })
    .extend({
      validation: {
        validator: function(val) {
          var bitcore = require('bitcore');
          return bitcore.Address.validate(val);
        },
        message: i18n.t("is_invalid_via_address")
      }
    });

  self.validationModel = ko.validatedObservable({
    documentHash: self.documentHash,
    source: self.source,
    destination: self.destination
  });

  self.resetForm = function() {
    self.destination("");
    self.source("");
    self.documentHash("");
    self.validationModel.errors.showAllMessages(false);
  }

  self.show = function(hashString, source) {
    self.resetForm();
    self.documentHash(hashString);
    self.source(source);
    self.shown(true);
  }

  self.hide = function() {
    self.shown(false);
  }

  self.doAction = function(){
    options = {
      source: self.source(),
      destination: self.destination(),
      hash_string: self.documentHash(),
      hash_type: 0
    }

    WALLET.doTransaction(self.source(), "create_notary_transfer", options,
                         function(txHash, data, endpoint, addressType, armoryUTx) {
                           var message = i18n.t("notary_transfer_message", self.documentHash().substring(0,16), self.destination());
                           message = message.replace(/<Ad>/g, '<b class="notoAssetColor">').replace(/<\/Ad>/g, '</b>');
                           WALLET.showTransactionCompleteDialog(message + ACTION_PENDING_NOTICE, message, armoryUTx);
                           self.resetForm();
                         }
    );

    self.shown(false);
  }

  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }

    //data entry is valid...submit to the server
    $('#transferDocumentModal form').submit();
  }
}

function VerifyDocumentModal() {
  var self = this;

  self.shown = ko.observable(false);
  self.documentHash = ko.observable("")
    .extend({required: true})
    .extend({pattern: {
      params: '^[0-9A-Fa-f]{64}$',
      message: i18n.t('is_invalid_sha2_hash')
    }});
  self.documentFile = ko.observable("");

  self.validationModel = ko.validatedObservable({
    documentHash: self.documentHash,
    documentFile: self.documentFile
  });

  self.resetForm = function() {
    self.documentHash("");
    self.documentFile("");
    self.validationModel.errors.showAllMessages(false);
  }

  self.show = function() {
    self.resetForm();
    self.shown(true);
  }
  self.hide = function() {
    self.shown(false);
  }

  self.showResult = function(data, endpoint) {
    var msg = "";
    if (!data.length || !data[0].tx_hash) {
        msg = "<h1>" + i18n.t("notary_not_found_header") + "</h1><br />" + i18n.t("notary_does_not_exist_header", self.documenthash());
    } else {
        msg = "<h1>" + i18n.t("notary_found_header") + "</h1><br />" +
              i18n.t("notary_description") + ": <b class='notoAssetColor'>" + data[0].description + "</b><br/>" +
              i18n.t("notary_document_hash") + ": <b class='notoAssetColor'>" + data[0].hash_string + "</b><br/>" +
              i18n.t("notary_owned_by") + ": <b class='notoAssetColor'>" + data[0].owner + "</b>";
    }

    msg = msg.replace(/<Ad>/g, '<b class="notoAssetColor">').replace(/<\/Ad>/g, '</b>');

    bootbox.alert({message: msg});
  }

  self.doAction = function(){
    options = { hash_string: self.documentHash(),
                hash_type: 0
    }
    failoverAPI('get_document_for_hash', options, self.showResult);
    self.shown(false);
  }

  self.doHash = function(f,event){
    var f = event.target.files[0];

    handleFileSelect(f);

    var progress = function(p) {
      var w = ((p*100).toFixed(0));
    }

    var  finished = function(result) {
      self.documentHash(result.toString(CryptoJSH.enc.Hex))
    }

    function handleFileSelect(f) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var data = e.target.result;
        setTimeout(function() {
          var a = CryptoJSH.SHA256(data,progress,finished);
        }, 200);
      };
      reader.onprogress = function(evt) {
        if (evt.lengthComputable) {
          var w = (((evt.loaded / evt.total)*100).toFixed(2));
        }
      }
      reader.readAsBinaryString(f);
    }
  }
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }

    //data entry is valid...submit to the server
    $('#verifyDocumentModal form').submit();
  }
}
