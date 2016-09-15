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
	   // Set magic numbers from dcrd/chaincfg/params.go
      var reductionInterval = 6144;
      var base = 3119582664;
      var mulSubsidy = 100;
      var divSubsidy = 101;
      var workProportion = 6;
      var stakeProportion = 3;
      var taxProportion = 1;

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
         // If block height is below mainnet voting height, leave out stake
      if (info.result.version == 0) {
        if (info.result.height == 0) {
       	  info.result.reward = 0;
        } else if (info.result.height == 1) {
	  info.result.reward = 100000;
        } else if (info.result.height < 768) {
          info.result.reward = Math.round(work + tax) / bitcore.util.COIN;
        } else {
          info.result.reward = Math.round(work + stake + tax) / bitcore.util.COIN;
        }
      } else if (info.result.version == 1) {
        if (info.result.height == 0) {
       	  info.result.reward = 0;
        } else if (info.result.height == 1) {
	  info.result.reward = 1680000;
        } else if (info.result.height < 4096) {
          info.result.reward = Math.round(work + tax) / bitcore.util.COIN;
        } else {
          info.result.reward = Math.round(work + stake + tax) / bitcore.util.COIN;
        }
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


