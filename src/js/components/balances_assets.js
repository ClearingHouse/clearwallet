ko.validation.rules['assetNameIsTaken'] = {
  async: true,
  message: i18n.t('token_already_exists'),
  validator: function (val, self, callback) {
    failoverAPI("get_issuances",
      {'filters': {'field': 'asset', 'op': '==', 'value': val}, 'status': 'valid'},
      function(data, endpoint) {
        return data.length ? callback(false) : callback(true) //empty list -> true (valid = true)
      }
    );   
  }
};
// TODO: DRY!!
ko.validation.rules['assetNameExists'] = {
  async: true,
  message: i18n.t('token_dont_exists'),
  validator: function (val, self, callback) {
    failoverAPI("get_issuances", {'filters': {'field': 'asset', 'op': '==', 'value': val}, 'status': 'valid'},
      function(data, endpoint) {
        $.jqlog.debug("Asset exists: " + data.length);
        return data.length ? callback(true) : callback(false) //empty list -> false (valid = false)
      }
    );   
  }
};
ko.validation.rules['isValidAssetNameLength'] = {
    validator: function (val, self) {
      //Check length
      var n = 0;
      for(var i=0; i < val.length; i++) {
        n *= 26;
        assert(B26_DIGITS.indexOf(val[i]) != -1); //should have been checked already
        n += B26_DIGITS.indexOf(val[i]); 
      }
      assert(n >= Math.pow(26, 3)); //should have been checked already
      return n <= MAX_INT;
    },
    message: i18n.t('asset_length_invalid')
};
ko.validation.rules['isValidAssetDescription'] = {
    validator: function (val, self) {
      return byteCount(val) <= MAX_ASSET_DESC_LENGTH;
    },
    message: i18n.t('token_desc_too_long', MAX_ASSET_DESC_LENGTH)
};
ko.validation.registerExtenders();


function CreateAssetModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable('');

  self.name = ko.observable('').extend({
    required: true,
    pattern: {
      message: i18n.t("token_name_rules"),
      params: '^[B-Z][A-Z]{3,}$'
    },
    isValidAssetNameLength: self,
    assetNameIsTaken: self
  });
  self.description = ko.observable('').extend({
    required: false,
    isValidAssetDescription: self
  });
  self.divisible = ko.observable(true);
  self.quantity = ko.observable().extend({
    required: true,
    isValidPositiveQuantityOrZero: self,
    isValidQtyForDivisibility: self
  });
  self.callable = ko.observable(false);
  self.callDate = ko.observable(new Date(new Date().getTime() + 30*24*60*60*1000)).extend({
    //^ default to current date + 30 days for now (also serves to hide a bug with the required
    // field validation not working if this field is empty). This is temporary...
    date: true,
    required: {
      message: i18n.t("call_date_required"),
      onlyIf: function () { return (self.callable() === true); }
    }
  });
  self.callPrice = ko.observable(0).extend({
    required: {
      message: i18n.t("call_price_required"),
      onlyIf: function () { return (self.callable() === true); }
    },
    isValidPositiveQuantityOrZero: self
  });
  
  self.validationModel = ko.validatedObservable({
    name: self.name,
    description: self.description,
    quantity: self.quantity,
    callDate: self.callDate,
    callPrice: self.callPrice
  });  

  self.resetForm = function() {
    self.name('');
    self.description('');
    self.divisible(true);
    self.quantity(null);
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if(self.name.isValidating()) {
      setTimeout(function() { //wait a bit and call again
        self.submitForm();
      }, 50);
      return;
    }
    
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    
    //data entry is valid...submit to the server
    $('#createAssetModal form').submit();
  }

  self.doAction = function() {
    var quantity = parseFloat(self.quantity());
    var rawQuantity = denormalizeQuantity(quantity, self.divisible());
    
    if(rawQuantity > MAX_INT) {
      bootbox.alert(i18n.t("issuance_quantity_too_high"));
      return false;
    }
    
    if(self.callable() && self.callDate() <= new Date()) {
      bootbox.alert(i18n.t("call_date_in_past"));
      return false;
    }
    
    WALLET.doTransaction(self.address(), "create_issuance",
      { source: self.address(),
        asset: self.name(),
        quantity: rawQuantity,
        divisible: self.divisible(),
        description: self.description(),
        callable_: self.callable(),
        call_date: self.callable() ? parseInt(self.callDate().getTime() / 1000) : null, //epoch ts
        call_price: self.callable() ? parseFloat(self.callPrice()) : null, //float
        transfer_destination: null
      },
      function(txHash, data, endpoint, addressType, armoryUTx) {
        var message = "";
        if (armoryUTx) {
          message = i18n.t("token_will_be_created", self.name());
        } else {
          message = i18n.t("token_has_been_created", self.name());
        }
        message +=  "<br/><br/>";
        message += i18n.t("issuance_end_message", getAddressLabel(self.address()), ASSET_CREATION_FEE_XCP);

        WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
      }
    );
    self.shown(false);
    trackEvent('Assets', 'CreateAsset');
  }
  
  self.show = function(address, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(address);
    self.shown(true);
    trackDialogShow('CreateAsset');
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


function IssueAdditionalAssetModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable(''); // SOURCE address (supplied)
  self.divisible = ko.observable();
  self.asset = ko.observable();
  
  self.additionalIssue = ko.observable('').extend({
    required: true,
    isValidPositiveQuantity: self,
    isValidQtyForDivisibility: self,
    validation: {
      validator: function (val, self) {
        return self.rawAdditionalIssue() + self.asset().rawSupply() <= MAX_INT;
      },
      message: i18n.t('issuance_exceed_max_quantity'),
      params: self
    }    
  });
  
  self.dispTotalIssued = ko.computed(function() {
    if(!self.asset()) return null;
    return self.asset().dispTotalIssued();
  }, self);
  
  self.rawAdditionalIssue = ko.computed(function() {
    if(!self.asset() || !isNumber(self.additionalIssue())) return null;
    return denormalizeQuantity(self.additionalIssue(), self.asset().DIVISIBLE); 
  }, self);

  self.validationModel = ko.validatedObservable({
    additionalIssue: self.additionalIssue
  });

  self.resetForm = function() {
    self.additionalIssue(null);
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    $('#issueAdditionalAssetModal form').submit();
  }

  self.doAction = function() {
    //do the additional issuance (specify non-zero quantity, no transfer destination)
    WALLET.doTransaction(self.address(), "create_issuance",
      { source: self.address(),
        quantity: self.rawAdditionalIssue(),
        asset: self.asset().ASSET,
        divisible: self.asset().DIVISIBLE,
        description: self.asset().description(),
        callable_: self.asset().CALLABLE,
        call_date: self.asset().CALLABLE ? self.asset().CALLDATE : 0,
        call_price: self.asset().CALLABLE ? self.asset().CALLPRICE : 0,
        transfer_destination: null
      },
      function(txHash, data, endpoint, addressType, armoryUTx) {
        self.shown(false);
        
        var message = ""; 
        if (armoryUTx) {
          message = i18n.t("you_will_be_issuing", self.additionalIssue(), self.asset().ASSET);
        } else {
          message = i18n.t("you_have_issued", self.additionalIssue(), self.asset().ASSET);
        }
        
        WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
      }
    );
    trackEvent('Assets', 'IssueAdditionalAsset');
  }
  
  self.show = function(address, divisible, asset, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(address);
    self.divisible(divisible);
    self.asset(asset);
    self.shown(true);
    trackDialogShow('IssueAdditionalAsset');
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


function TransferAssetModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable(''); // SOURCE address (supplied)
  self.asset = ko.observable();
  
  self.destAddress = ko.observable('').trimmed().extend({
    required: true,
    isValidBitcoinAddress: self,
    isNotSameBitcoinAddress: self
  });
  
  self.validationModel = ko.validatedObservable({
    destAddress: self.destAddress
  });

  self.resetForm = function() {
    self.destAddress('');
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    $('#transferAssetModal form').submit();
  }

  self.doAction = function() {
    //do the transfer (zero quantity issuance to the specified address)
    WALLET.doTransaction(self.address(), "create_issuance",
      { source: self.address(),
        quantity: 0,
        asset: self.asset().ASSET,
        divisible: self.asset().DIVISIBLE,
        description: self.asset().description(),
        callable_: self.asset().CALLABLE,
        call_date: self.asset().CALLABLE ? self.asset().CALLDATE : 0,
        call_price: self.asset().CALLABLE ? self.asset().CALLPRICE : 0,
        transfer_destination: self.destAddress()
      },
      function(txHash, data, endpoint, addressType, armoryUTx) {
        self.shown(false);
        
        var message = "";
        if (armoryUTx) {
          message = i18n.t("asset_will_be_transfered", self.asset().ASSET, self.destAddress());
        } else {
          message = i18n.t("asset_has_been_transfered", self.asset().ASSET, self.destAddress());
        }
        WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
      }
    );
    trackEvent('Assets', 'TransferAsset');
  }
  
  self.show = function(sourceAddress, asset, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(sourceAddress);
    self.asset(asset);
    self.shown(true);
    trackDialogShow('TransferAsset');
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


function ChangeAssetDescriptionModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable(''); // SOURCE address (supplied)
  self.asset = ko.observable();
  
  self.newDescription = ko.observable('').extend({
    required: true,
    isValidAssetDescription: self,
    validation: {
      validator: function (val, self) {
        return self.newDescription() != self.asset().description();
      },
      message: i18n.t('same_description_token'),
      params: self
    },    
    newDescIsNotSameAsCurrentDesc: self
  });
  
  self.dispAssetDescription = ko.computed(function() {
    return self.asset() ? self.asset().description() : '';
  }, self);

  self.dispCharactersRemaining = ko.computed(function() {
    if(!self.newDescription() || self.newDescription().length > MAX_ASSET_DESC_LENGTH) return '';
    return ' (' + i18n.t('x_bytes_remaining', MAX_ASSET_DESC_LENGTH - byteCount(self.newDescription())) + ')';
  }, self);
    
  self.validationModel = ko.validatedObservable({
    newDescription: self.newDescription
  });

  self.resetForm = function() {
    self.newDescription('');
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    $('#changeAssetDescriptionModal form').submit();
  }

  self.doAction = function() {
    //to change the desc, issue with quantity == 0 and the new description in the description field
    WALLET.doTransaction(self.address(), "create_issuance",
      { source: self.address(),
        quantity: 0,
        asset: self.asset().ASSET,
        divisible: self.asset().DIVISIBLE,
        description: self.newDescription(),
        callable_: self.asset().CALLABLE,
        call_date: self.asset().CALLABLE ? self.asset().CALLDATE : 0,
        call_price: self.asset().CALLABLE ? self.asset().CALLPRICE : 0,
        transfer_destination: null
      },
      function(txHash, data, endpoint, addressType, armoryUTx) {
        self.shown(false);
        var message = "";
        if (armoryUTx) {
          message = i18n.t("desc_will_be_changed", self.asset().ASSET, self.newDescription());
        } else {
          message = i18n.t("desc_has_been_changed", self.asset().ASSET, self.newDescription());
        } 
        WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
      }
    );
    trackEvent('Assets', 'ChangeAssetDescription');
  }
  
  self.show = function(address, asset, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(address);
    self.asset(asset);
    self.shown(true);
    trackDialogShow('ChangeAssetDescription');
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


var DividendAssetInDropdownItemModel = function(asset, rawBalance, normalizedBalance) {
  this.ASSET = asset;
  this.RAW_BALANCE = rawBalance; //raw
  this.NORMALIZED_BALANCE = normalizedBalance; //normalized
  this.SELECT_LABEL = asset + " (" + i18n.t('bal') + ": " + normalizedBalance + ")";
};
function PayDividendModalViewModel() {
  var self = this;

  self.shown = ko.observable(false);
  self.addressVM = ko.observable(null); // SOURCE address view model(supplied)
  self.assetData = ko.observable(null);
  self.holderCount = ko.observable(null);
  
  self.assetName = ko.observable('').extend({
    required: true,
    pattern: {
      message: i18n.t("token_name_rules"),
      params: '^[B-Z][A-Z]{3,}$'
    },
    isValidAssetNameLength: self,
    assetNameExists: self,
    rateLimit: { timeout: 500, method: "notifyWhenChangesStop" },
    validation:  {
      validator: function (val, self) {
        if(!self.assetData()) return true; //wait until dividend asset chosen to validate
        
        var supply = new Decimal(normalizeQuantity(self.assetData().supply, self.assetData().divisible));
        // we substract user balance for this asset
        var userAsset = self.addressVM().getAssetObj(self.assetName());
        if (userAsset) {
          supply = supply.sub(new Decimal(userAsset.normalizedBalance()));
        }
        return supply > 0
      },
      message: i18n.t('no_dividend_to_distribute'),
      params: self
    }
  });
  // TODO: DRY! we already make a query to check if assetName exists
  self.assetName.subscribe(function(name) {
    if (!name) return;
    failoverAPI("get_asset_info", {'assets': [name]}, function(assetsData, endpoint) {
      failoverAPI('get_holder_count', {'asset':name}, function(holderData) {
        self.assetData(assetsData[0]);
        self.holderCount(holderData[name]);
      });
    });
  });
  
  self.availableDividendAssets = ko.observableArray([]);
  self.selectedDividendAsset = ko.observable(null).extend({ //dividends are paid IN (i.e. with) this asset
    required: true
  });
  self.selectedDividendAssetDivisibility =  ko.observableArray(null);
  self.selectedDividendAsset.subscribe(function(asset) {
    self.selectedDividendAssetDivisibility(WALLET.isAssetDivisibilityAvailable(asset) == 0 ? false : true); // asset divisibility should be available..
  });
  
  self.quantityPerUnit = ko.observable('').extend({
    required: true,
    isValidPositiveQuantity: self,
    validation: [{
      validator: function (val, self) {
        if(self.dividendAssetBalRemainingPostPay() === null) return true; //wait until dividend asset chosen to validate
        return self.dividendAssetBalRemainingPostPay() >= 0;
      },
      message: i18n.t('total_diviend_exceed_balance'),
      params: self
    }, {
      validator: function (val, self) {
        if (!self.selectedDividendAsset()) return true;
        if (!self.selectedDividendAssetDivisibility()) {
          return parseFloat(val) % 1 == 0;
        } else {
          return true;
        }
      },
      message: i18n.t('nodivisible_amount_incorrect'),
      params: self
    }]
  });
  
  self.totalPay = ko.computed(function() {
    if(!self.assetData() || !isNumber(self.quantityPerUnit()) || !parseFloat(self.quantityPerUnit())) return null;

    var supply = new Decimal(normalizeQuantity(self.assetData().supply, self.assetData().divisible));
    // we substract user balance for this asset
    var userAsset = self.addressVM().getAssetObj(self.assetName());
    if (userAsset) {
      supply = supply.sub(new Decimal(userAsset.normalizedBalance()));
    }
    var totalPay = new Decimal(self.quantityPerUnit()).mul(supply);
    
    return Decimal.round(totalPay, 8, Decimal.MidpointRounding.ToEven).toFloat();

  }, self);

  self.totalFee = ko.computed(function() {
    if(!self.holderCount() || !isNumber(self.quantityPerUnit()) || !parseFloat(self.quantityPerUnit())) return null;
    if (USE_TESTNET || WALLET.networkBlockHeight() > 375000) {
      return mulFloat(self.holderCount(), DIVIDEND_FEE_PER_HOLDER);
    } else {
      return 0;
    }
  });
  
  self.dispTotalPay = ko.computed(function() {
    return smartFormat(self.totalPay());
  }, self);

  self.dispTotalFee= ko.computed(function() {
    return smartFormat(self.totalFee());
  }, self);

  self.dividendAssetBalance = ko.computed(function() {
    if(!self.selectedDividendAsset()) return null;
    return WALLET.getBalance(self.addressVM().ADDRESS, self.selectedDividendAsset()); //normalized
  }, self);

  self.dividendAssetBalRemainingPostPay = ko.computed(function() {
    if(!self.assetData() || self.dividendAssetBalance() === null || self.totalPay() === null) return null;
    return Decimal.round(new Decimal(self.dividendAssetBalance()).sub(self.totalPay()), 8, Decimal.MidpointRounding.ToEven).toFloat();
  }, self);
  
  self.dispDividendAssetBalRemainingPostPay = ko.computed(function() {
    return smartFormat(self.dividendAssetBalRemainingPostPay());
  }, self);
  
  self.validationModel = ko.validatedObservable({
    quantityPerUnit: self.quantityPerUnit,
    selectedDividendAsset: self.selectedDividendAsset,
    assetName: self.assetName
  });

  self.resetForm = function() {
    self.quantityPerUnit(null);
    self.availableDividendAssets([]);
    self.selectedDividendAsset(null);
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {   
    $('#payDividendModal form').submit();
  }
  
  self.doAction = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }
    
    // fetch shareholders to check transaction dest.
    if (self.selectedDividendAsset() == 'VIA') {
      var params = {
        'filters': [
          {'field': 'asset', 'op': '=', 'value': self.assetData().asset},
          {'field': 'quantity', 'op': '>', 'value': 0}
        ],
        'filterop': 'AND'
      }
      failoverAPI('get_balances', params, self.sendDividend)
    } else {
      self.sendDividend();
    }
  }

  self.sendDividend = function(data) {

    var params = {
      source: self.addressVM().ADDRESS,
      quantity_per_unit: denormalizeQuantity(parseFloat(self.quantityPerUnit())),
      asset: self.assetData().asset,
      dividend_asset: self.selectedDividendAsset()
    }
  
    if (data) {
      var dests = [];
      for (var a in data) {
        dests.push(data[a]['address']);
      }
      params['_btc_dividend_dests'] = dests;
    }

    WALLET.doTransaction(self.addressVM().ADDRESS, "create_dividend", params,
      function(txHash, data, endpoint, addressType, armoryUTx) {
        self.shown(false);
        var message = "";
        if (armoryUTx) {
          message = i18n.t("you_will_paying_dividend", self.quantityPerUnit(), self.selectedDividendAsset(), self.assetData().asset);
        } else {
          message = i18n.t("you_have_paid_dividend", self.quantityPerUnit(), self.selectedDividendAsset(), self.assetData().asset);
        }
        WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
      }
    );
    trackEvent('Assets', 'PayDividend');
  }

  self.showModal = function(address, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.addressVM(address);
    self.assetName('');
    self.assetData(null);
    self.shown(true);
    trackDialogShow('PayDividend');
    
    //Get the balance of ALL assets at this address
    failoverAPI("get_normalized_balances", {'addresses': [address.ADDRESS]}, function(data, endpoint) {
      for(var i=0; i < data.length; i++) {
        if(data[i]['quantity'] !== null && data[i]['quantity'] !== 0)
          self.availableDividendAssets.push(new DividendAssetInDropdownItemModel(data[i]['asset'], data[i]['quantity'], data[i]['normalized_quantity']));
      }

      //Also get the BTC balance at this address and put at head of the list
      WALLET.retrieveBTCBalance(address.ADDRESS, function(balance) {
        if(balance) {
          self.availableDividendAssets.unshift(new DividendAssetInDropdownItemModel("VIA", balance, normalizeQuantity(balance)));
        }
      });
    });
  }
  
  self.show = function(address, resetForm) {
    trackDialogShow('PayDividendAttempt');
    checkCountry("dividend", function() {
      self.showModal(address, resetForm);
    });
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


function CallAssetModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable(null); // SOURCE address (supplied)
  self.asset = ko.observable(null); // Asset to call (supplied)
  self.assetObj = ko.observable(null);
  
  self.percentageToCall = ko.observable(null).extend({
    required: true,
    isValidPositiveQuantity: self,
    max: 100,
    min: 0.00001,
    validation: {
      validator: function (val, self) {
        if(self.xcpBalRemainingPostCall() === null) return true; //wait until dividend asset chosen to validate
        return self.xcpBalRemainingPostCall() >= 0;
      },
      message: i18n.t('total_diviend_exceed_balance'),
      params: self
    }    
  });

  self.dispCallDate = ko.computed(function() {
    if(!self.assetObj()) return null;
    return self.assetObj().dispCallDate();
  }, self);
    
  self.dispCallPrice = ko.computed(function() {
    if(!self.assetObj()) return null;
    return self.assetObj().CALLPRICE;
  }, self);
  
  self.dispTotalIssued = ko.computed(function() {
    if(!self.assetObj()) return null;
    return self.assetObj().normalizedTotalIssued();
  }, self); 
  
  self.dispTotalOutstanding = ko.computed(function() {
    //total qty of this asset in hands other than the asset's owner
    if(!self.assetObj()) return null;
    return self.assetObj().normalizedTotalIssued() - self.assetObj().normalizedBalance();
  }, self); 

  self.unitsToCallback = ko.computed(function() {
    if(!self.dispTotalOutstanding() || !self.percentageToCall()) return null;
    return self.dispTotalOutstanding() * Decimal.round(new Decimal(self.percentageToCall()).div(100), 8, Decimal.MidpointRounding.ToEven).toFloat(); 
  }, self); 

  self.dispUnitsToCallback = ko.computed(function() {
    return smartFormat(self.unitsToCallback(), null, 4); 
  }, self); 

  self.unitsAfterCallback = ko.computed(function() {
    if(!self.assetObj() || !self.unitsToCallback()) return null;
    return self.assetObj().normalizedBalance() + self.unitsToCallback();
  }, self); 

  self.dispUnitsAfterCallback = ko.computed(function() {
    return smartFormat(self.unitsAfterCallback(), null, 4); 
  }, self); 

  self.totalXCPPay = ko.computed(function() {
    if(!self.percentageToCall() || !self.assetObj()) return null;
    return +(self.percentageToCall() * (self.assetObj().normalizedTotalIssued() - self.assetObj().normalizedBalance()) * self.assetObj().CALLPRICE).toFixed(4);
  }, self);

  self.xcpBalRemainingPostCall = ko.computed(function() {
    if(self.totalXCPPay() === null) return null;
    return Decimal.round(new Decimal(WALLET.getBalance(self.address(), 'XCH')).sub(self.totalXCPPay()), 8, Decimal.MidpointRounding.ToEven).toFloat();
  }, self);
  
  self.xcpBalRemainingPostCallIsSet = ko.computed(function() {
    return self.xcpBalRemainingPostCall() !== null;
  }, self);

  self.dispXCPBalRemainingPostCall = ko.computed(function() {
    return smartFormat(self.xcpBalRemainingPostCall(), null, 4);
  }, self);
  
  self.validationModel = ko.validatedObservable({
    percentageToCall: self.percentageToCall
  });

  self.dispXCPBalRemainingPostCallCss = ko.computed(function() {
    return self.xcpBalRemainingPostCall() < 0 ? 'errorColor' : 'sellColor';
  }, self);

  self.resetForm = function() {
    self.percentageToCall(null);
    self.validationModel.errors.showAllMessages(false);
  }
  
  self.submitForm = function() {
    if (!self.validationModel.isValid()) {
      self.validationModel.errors.showAllMessages();
      return false;
    }    
    $('#callAssetModal form').submit();
  }

  self.doAction = function() {
    //do the additional issuance (specify non-zero quantity, no transfer destination)
    WALLET.doTransaction(self.address(), "create_callback",
      { source: self.address(),
        fraction: Decimal.round(new Decimal(self.percentageToCall()).div(100), 8, Decimal.MidpointRounding.ToEven).toFloat(),
        asset: self.asset()
      },
      function(txHash, data, endpoint, addressType, armoryUTx) {
        self.shown(false);

        var message = "";
        if (armoryUTx) {
          message = i18n.t("you_will_calling_back", self.percentageToCall(), self.asset(), self.totalXCPPay());
        } else {
          message = i18n.t("you_have_called_back", self.percentageToCall(), self.asset(), self.totalXCPPay());
        }
        
        WALLET.showTransactionCompleteDialog(message + " " + i18n.t(ACTION_PENDING_NOTICE), message, armoryUTx);
      }
    );
    trackEvent('Assets', 'CallAsset');
  }
  
  self.show = function(address, asset, resetForm) {
    if(typeof(resetForm)==='undefined') resetForm = true;
    if(resetForm) self.resetForm();
    self.address(address);
    self.asset(asset);
    self.assetObj(WALLET.getAddressObj(address).getAssetObj(asset));
    var now = new Date(); 
    var nowUTC = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());

    //Check if the passed asset is callable
    assert(self.assetObj().isMine(), "Token is not yours!");
    assert(self.assetObj().CALLABLE, "Token is not callable!");

    var callDate = new Date(0);
    callDate.setUTCSeconds(self.assetObj().CALLDATE);
    if(callDate > nowUTC) {
      bootbox.alert(i18n.t("token_not_callable_until", self.asset(), self.assetObj().dispCallDate()));
      return;
    }
    self.shown(true);
    trackDialogShow('CallAsset');
  }  

  self.hide = function() {
    self.shown(false);
  }  
}


var AssetHistoryItemModel = function(historyObj) {
  var self = this;
  self.HISTORYOBJ = historyObj;
  
  self.dispBlockTime = function() {
    return moment(self.HISTORYOBJ['at_block_time']).format("M/D/YY h:mm:ssa");
  }

  self.dispDescription = function() {
    var desc = '';
    if(self.HISTORYOBJ['type'] == 'created') {
      desc = i18n.t("token_created", self.HISTORYOBJ['description'], numberWithCommas(self.HISTORYOBJ['total_issued_normalized']), getAddressLabel(self.HISTORYOBJ['owner']));
    } else if(self.HISTORYOBJ['type'] == 'issued_more') {
      desc = i18n.t("additional_issuance_done", numberWithCommas(self.HISTORYOBJ['additional_normalized']), numberWithCommas(self.HISTORYOBJ['total_issued_normalized']));
    } else if(self.HISTORYOBJ['type'] == 'changed_description') {
      desc = i18n.t("descripition_changed_to", self.HISTORYOBJ['new_description']);
    } else if(self.HISTORYOBJ['type'] == 'locked') {
      desc = i18n.t("token_locked");
    } else if(self.HISTORYOBJ['type'] == 'transferred') {
      desc = i18n.t("token_transferred_from_to", getAddressLabel(self.HISTORYOBJ['prev_owner']), getAddressLabel(self.HISTORYOBJ['new_owner']));
    } else if(self.HISTORYOBJ['type'] == 'called_back') {
      desc = i18n.t("x_tokens_called_back", self.HISTORYOBJ['percentage']);
    } else {
      desc = i18n.t("unknown_op") + " <b>" + self.HISTORYOBJ['type'] + "</b>";
    }
    
    desc = desc.replace(/<Am>/g, '<b class="notoQuantityColor">').replace(/<\/Am>/g, '</b>');
    desc = desc.replace(/<Ad>/g, '<b class="notoAddrColor">').replace(/<\/Ad>/g, '</b>');
    return desc;
  }
};

function ShowAssetInfoModalViewModel() {
  var self = this;
  self.shown = ko.observable(false);
  self.address = ko.observable(null);
  self.asset = ko.observable(null);
  self.owner = ko.observable(null);
  self.description = ko.observable(null);
  self.totalIssued = ko.observable(null);
  self.locked = ko.observable(null);
  self.divisible = ko.observable(null);
  self.callable = ko.observable(null);
  self.callDate = ko.observable(null);
  self.callPrice = ko.observable(null);
  self.history = ko.observableArray([]);
  
  self.extImageURL = ko.observable(null);
  self.extWebsite = ko.observable(null);
  self.extDescription = ko.observable(null);
  self.extPGPSigURL = ko.observable(null);
  
  self.dispTotalIssued = ko.computed(function() {
    return smartFormat(self.totalIssued()); 
  }, self); 

  self.showHistory = ko.computed(function() {
    return self.history().length ? true : false; 
  }, self); 

  self.show = function(assetObj) {
    self.address(assetObj.ADDRESS);
    self.asset(assetObj.ASSET);
    self.owner(assetObj.owner());
    self.description(assetObj.description());
    self.totalIssued(assetObj.normalizedTotalIssued());
    self.locked(assetObj.locked());
    self.divisible(assetObj.DIVISIBLE);
    self.callable(assetObj.CALLABLE);
    self.callDate(assetObj.dispCallDate());
    self.callPrice(assetObj.CALLPRICE);
    self.history([]); //clear until we have the data from the API call below...
    
    //Fetch the asset history and populate the table with it
    failoverAPI("get_asset_extended_info", {'asset': assetObj.ASSET},
      function(ext_info, endpoint) {
        if(!ext_info)
          return; //asset has no extended info
        
        if(ext_info['image'])
          self.extImageURL((USE_TESTNET ? '/_t_asset_img/' : '/_asset_img/') + assetObj.ASSET + '.png');
        
        self.extWebsite(ext_info['website']);
        self.extDescription(ext_info['description']);
        self.extPGPSigURL(ext_info['pgpsig']);
      }
    );   
    
    failoverAPI("get_asset_history", {'asset': assetObj.ASSET, 'reverse': true},
      function(history, endpoint) {
        for(var i=0; i < history.length; i++) {
          self.history.push(new AssetHistoryItemModel(history[i]));
        }
      }
    );   
    
    self.shown(true);
    trackDialogShow('ShowAssetInfo');
  }  

  self.hide = function() {
    self.shown(false);
  }  
}

function CreateDocumentModalViewModel() {
  var self = this;

  self.shown = ko.observable(false);
  self.documentHash = ko.observable("").extend({required: true});
  self.documentDescription = ko.observable("").extend({required: false});
  self.address = ko.observable('');

  self.validationModel = ko.validatedObservable({
    documentHash: self.documentHash,
    documentDescription: self.documentDescription,
  });

  self.resetForm = function() {
    self.address("");
    self.documentHash("");
    self.documentDescription("");
    self.validationModel.errors.showAllMessages(false);
  }

  self.show = function(address) {
    self.resetForm();
    self.address(address);
    self.shown(true);
  }
  self.hide = function() {
    self.shown(false);
  }

  self.doAction = function(){
    options = { source: self.address(),
         description: self.documentDescription(),
         hash_string: self.documentHash(),
         hash_type: 0
     }
    WALLET.doTransaction(self.address(), "create_notary", options,
       function(txHash, data, endpoint, addressType, armoryUTx) {
         var message = i18n.t("notary_created_dialog", self.documentHash()) + "<br/><br/>";
         message = message + i18n.t("notary_will_auto_confirm");
         message = message.replace(/<Ad>/g, '<b class="notoAssetColor">').replace(/<\/Ad>/g, '</b>');
         WALLET.showTransactionCompleteDialog(message + ACTION_PENDING_NOTICE, message, armoryUTx);
         self.resetForm();
       }
    );
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
    $('#createDocumentModal form').submit();
  }
}
/*NOTE: Any code here is only triggered the first time the page is visited. Put JS that needs to run on the
  first load and subsequent ajax page switches in the .html <script> tag*/
