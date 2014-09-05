function DocumentViewModel() {
  var self = this;

  self.myDocuments = ko.observableArray(null);
  self.myDocumentState = ko.observableArray(null);

  self.createDocumentTransfer = function(doc){
    self.documentTransferModal.show(doc.hash_string, doc.owner)
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

    failoverAPI('get_documents_for', {'addresses': WALLET.getAddressesList()}, self.displayDocuments);
    failoverAPI('get_document_state_for', {'addresses': WALLET.getAddressesList()}, self.displayDocumentState);
  }
}

function DocumentTransferModal() {
  var self = this;

  self.shown = ko.observable(false);
  self.documentHash = ko.observable("").extend({required: true});
  self.source = ko.observable("").extend({required: true});
  self.destination = ko.observable("").extend({required: true});

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
                           var message = "Your document with hash <b class='notoAssetColor'>" + self.documentHash().substring(0,16)+"..." + " </b>will be transferred to " + self.destination() + "."
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
