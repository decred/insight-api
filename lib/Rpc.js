'use strict';

var imports     = require('soop').imports();

var bitcore         = require('bitcore'),
    RpcClient       = bitcore.RpcClient,
    BitcoreBlock    = bitcore.Block,
	util            = require('util'),
    config          = require('../config/config');

var  bitcoreRpc  = imports.bitcoreRpc || new RpcClient(config.bitcoind);

function Rpc() {
}

Rpc._parseTxResult = function(info) {
  var b  = new Buffer(info.hex,'hex');

  // remove fields we dont need, to speed and adapt the information
  delete info.hex;
  var emptyTxid = "0000000000000000000000000000000000000000000000000000000000000000";
  // Inputs => add index + coinBase flag
  var n =0;
  info.vin.forEach(function(i) {
    i.n = n++;
    if (i.coinbase) info.isCoinBase = true;
     // checkout to see if vin is a stakebase for ssgen
    else if (i.txid === emptyTxid) i.isStakeBase = true;
  });

  // Outputs => add total
  var valueOutSat = 0;

  info.vout.forEach( function(o) {
    o.value = o.value.toFixed(8);
    valueOutSat += o.value * bitcore.util.COIN;
    // determine tx type
    if (o.scriptPubKey.asm.indexOf("SSGEN") > -1 ) {
	    info.ticketid = info.vin[1].txid;
	    info.isStakeGen = true;
	    info.voterVersion = 0;

	    // Extract and set voter version if exists.
	    if (info.vout[1].scriptPubKey.hex.length >= 16) {
        var versionBits = info.vout[1].scriptPubKey.hex.substring(8, 16);
        var hexLE = "";
        for (var i = versionBits.length - 2; i >= 0; i -= 2) {
            hexLE += versionBits.substring(i, i + 2);
        }
        var voteBits = info.vout[1].scriptPubKey.hex.substring(4,8);
        var agendasLE = ""; 
        for (var i = voteBits.length - 2; i >= 0; i -= 2) {
            agendasLE += voteBits.substring(i, i + 2);
        }
        info.agendas = new Array();
        if (config.network == 'dcrdlivenet') {
          // Agendas for mainnet vote version 4
          if (parseInt(hexLE, 16) == 4) {
            var lnsupportMask = 0x06;
            var sdiffMask=0x18;
            var lnsupport = 'LN: ';
            var sdiff = 'DCP0001: ';
            switch (parseInt(agendasLE, 16)&lnsupportMask) { case 0x02: lnsupport +='no';break;   case 0x04: lnsupport +='yes';break;   default: lnsupport+='abstain'; }
            switch (parseInt(agendasLE, 16)&sdiffMask) { case 0x08: sdiff +='no';break;  case 0x10: sdiff +='yes';break;   default: sdiff+='abstain'; }
            if (lnsupport != '') {
              info.agendas.push(lnsupport);
            }
            if (sdiff != '') {
              info.agendas.push(sdiff);
            }
          }
        } else if (config.network == 'dcrdtestnet') {
          // Agendas for mainnet vote version 5
          if (parseInt(hexLE, 16) == 5) {
            var sdiffMask=0x06;
            var choice = 'DCP0001: ';
            switch (parseInt(agendasLE, 16)&sdiffMask) { case 0x02: choice += 'no';break;  case 0x04: choice +='yes';break;   default: choice+='abstain'; }
            if (choice != '') {
              info.agendas.push(choice);
            }
          }
        }
        info.voterVersion = parseInt(hexLE, 16);
	    }
    } else if (o.scriptPubKey.asm.indexOf("SSTX") > -1 ) {
	    info.isStakeTx = true;
    } else if (o.scriptPubKey.asm.indexOf("SSRTX") > -1 ) {
            info.ticketid = info.vin[0].txid;
	    info.isStakeRtx = true;
    }
  });
  info.valueOut = valueOutSat.toFixed(0) / bitcore.util.COIN;
  info.size     = b.length;

  return info;
};


Rpc.errMsg = function(err) {
  var e = err;
  e.message += util.format(' [Host: %s:%d User:%s Using password:%s]',
                            bitcoreRpc.host,
                            bitcoreRpc.port,
                            bitcoreRpc.user,
                            bitcoreRpc.pass?'yes':'no'
                          );
  return e;
};

Rpc.getTxInfo = function(txid, doNotParse, cb) {
  var self = this;

  if (typeof doNotParse === 'function') {
    cb = doNotParse;
    doNotParse = false;
  }

  bitcoreRpc.getRawTransaction(txid, 1, function(err, txInfo) {
    // Not found?
    if (err && err.code === -5) return cb();
    if (err) return cb(self.errMsg(err));

    var info = doNotParse ? txInfo.result : self._parseTxResult(txInfo.result);
    return cb(null,info);
  });
};


Rpc.blockIndex = function(height, cb) {
  var self = this;

  bitcoreRpc.getBlockHash(height, function(err, bh){
    if (err) return cb(self.errMsg(err));
    cb(null, { blockHash: bh.result });
  });
};

Rpc.getBlock = function(hash, cb) {
  var self = this;

  bitcoreRpc.getBlock(hash, function(err,info) {
    // Not found?
    if (err) return cb(self.errMsg(err));
    if (info.result.height) {
      var reductionInterval;
      var base;
      var mulSubsidy;
      var divSubsidy;
      var workProportion;
      var stakeProportion;
      var taxProportion;

      // Set magic numbers from dcrd/chaincfg/params.go
      switch (config.network) {
      case 'dcrdlivenet':
        reductionInterval = 6144;
        base = 3119582664;
        mulSubsidy = 100;
        divSubsidy = 101;
        workProportion = 6;
        stakeProportion = 3;
        taxProportion = 1;
        break;
      case 'dcrdtestnet':
        reductionInterval = 2048;
        base = 2500000000;
        mulSubsidy = 100;
        divSubsidy = 101;
        workProportion = 6;
        stakeProportion = 3;
        taxProportion = 1;
        break;
      default:
        reductionInterval = 1;
        base = 1;
        mulSubsidy = 100;
        divSubsidy = 101;
        workProportion = 6;
        stakeProportion = 3;
        taxProportion = 1;
        break;
      }

      // Calculate number of base subidy reductions that have been done    
      var numReductions = Math.floor(info.result.height / reductionInterval);

      for (var i = 0; i < numReductions; i++) {
        base *= mulSubsidy
        base /= divSubsidy
      }

      // Number of voters for the block in question
      var votersProportion = info.result.voters == 0 ? 1 : info.result.voters / 5;

      // Calculate the 3 different portions of block reward

      var work = base * workProportion / 10 * votersProportion;
      var stake = base * stakeProportion / 10 * votersProportion;
      var tax = base * taxProportion / 10 * votersProportion;

      // If block height is below mainnet voting height, leave out stake
      if (info.result.height == 0) {
       	  info.result.reward = 0;
      } else if (info.result.height == 1) {
          if (config.network === 'dcrdlivenet') {
	    info.result.reward = 1680000;
          } else if (config.network === 'dcrdtestnet') {
            info.result.reward = 100000;
          }
      } else if ((info.result.height < 4096 && config.network === 'dcrdlivenet') ||
                 (info.result.height < 768 && config.network === 'dcrdtestnet')) {
          info.result.reward = Math.round(work + tax) / bitcore.util.COIN;
      } else {
          info.result.reward = Math.round(work + stake + tax) / bitcore.util.COIN;
      }
    }
    return cb(err,info.result);
  });
};

Rpc.sendRawTransaction = function(rawtx, cb) {
  bitcoreRpc.sendRawTransaction(rawtx, function(err, txid) {
    if (err) return cb(err);

    return cb(err, txid.result);
  });
};

Rpc.verifyMessage = function(address, signature, message, cb) {
  var self = this;
  bitcoreRpc.verifyMessage(address, signature, message, function(err, message) {
    if (err && (err.code === -3 || err.code === -5))
      return cb(err);  // -3 = invalid address, -5 = malformed base64 / etc.
    if (err)
      return cb(self.errMsg(err));

    return cb(err, message.result);
  });
};

module.exports = require('soop')(Rpc);


