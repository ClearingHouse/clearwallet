function DocumentViewModel() {
  var self = this;

  self.myDocuments = ko.observableArray(null);
  self.myDocumentState = ko.observableArray(null);

  self.displayDocumentState = function(data){
    docs = []
    for (var i in data) {
      var doc = {};
      doc['address'] = data[i]['owner'];
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
      doc['hash_string'] = data[i]['hash_string'].substring(0,16)+"...";

      docs.push(doc)
    }

    $('#myDocumentTable').dataTable().fnClearTable();
    self.myDocuments(docs);
    runDataTables('#myDocumentTable', true, {
      "aaSorting": [[3, 'desc']]
    });
  }

  self.init = function() {
    failoverAPI('get_documents_for', {'addresses': WALLET.getAddressesList()}, self.displayDocuments);
    failoverAPI('get_document_state_for', {'addresses': WALLET.getAddressesList()}, self.displayDocumentState);
  }
}
