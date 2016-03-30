var util = require("util");

exports.models = {

  generateValueArrayAverages: function(valueArrays, modelInfo) {

    for (i in modelInfo.dbToJsonMap) {
      if (i != modelInfo.timeStampColumn) {
        for (var j = 0; j < (valueArrays.length-1); j++) {
          for (var k = 0; k < valueArrays[j].values[modelInfo.dbToJsonMap[i]].length; k++ ) {
            valueArrays[j].averages[modelInfo.dbToJsonMap[i]] = (valueArrays[j].averages[modelInfo.dbToJsonMap[i]] == null) ? valueArrays[j].values[modelInfo.dbToJsonMap[i]][k] : valueArrays[j].averages[modelInfo.dbToJsonMap[i]]+valueArrays[j].values[modelInfo.dbToJsonMap[i]][k];
          }
          valueArrays[j].averages[modelInfo.dbToJsonMap[i]] = (valueArrays[j].averages[modelInfo.dbToJsonMap[i]] != null) ? valueArrays[j].averages[modelInfo.dbToJsonMap[i]]/valueArrays[j].values[modelInfo.dbToJsonMap[i]].length : valueArrays[j].averages[modelInfo.dbToJsonMap[i]] = valueArrays[j-1].averages[modelInfo.dbToJsonMap[i]];
        }      
      }
    }

    delete valueArrays[valueArrays.length-1];
    return valueArrays;
  },

  populateValueArrays: function(valueArrays, dbMetaRow, modelInfo) {
    for (var j = 0; j < (valueArrays.length-1); j++) { 
      if (    (dbMetaRow[modelInfo.timeStampColumn].valueOf() >= valueArrays[j].timestamp.valueOf())
          &&  (dbMetaRow[modelInfo.timeStampColumn].valueOf() < valueArrays[j+1].timestamp.valueOf())
          ) {
          for (k in modelInfo.dbToJsonMap) {
            if (k != modelInfo.timeStampColumn) {
              valueArrays[j].values[modelInfo.dbToJsonMap[k]].push(dbMetaRow[k]);
            }
          }
          break;
      }
    }
    return valueArrays;
  },

  constructValueArrays: function(arrayLength, dbMeta, modelInfo) {
    var valueArrays = [],
        startDateTime = (dbMeta.length > 0) ? dbMeta[0][modelInfo.timeStampColumn].valueOf() : 0,
        endDateTime = (dbMeta.length > 0) ? dbMeta[dbMeta.length-1][modelInfo.timeStampColumn].valueOf() : 0,
        timeInterval = Math.floor((endDateTime-startDateTime)/arrayLength);
    for (var i = 0; i <= arrayLength; i++) { 
      valueArrays[i] = { 
        timestamp: new Date(startDateTime+(i*timeInterval))/*+Math.round(timeInterval/2)*/,
        values: { }, averages: { }
      };
      for (j in modelInfo.dbToJsonMap) { 
        if (j != modelInfo.timeStampColumn) {
          valueArrays[i].values[modelInfo.dbToJsonMap[j]] = []; 
          valueArrays[i].averages[modelInfo.dbToJsonMap[j]] = null; 
        }
      }
    }
    return valueArrays;
  },

  finalizeValueArraysForOutput: function(valueArrays, modelInfo) {
    var outputJson = [];

    for (var i = 0; i < valueArrays.length; i++) {
      if (valueArrays[i] != null) {
        var asJson = {};
        asJson[modelInfo.dbToJsonMap[modelInfo.timeStampColumn]] = valueArrays[i].timestamp;
        for (j in modelInfo.dbToJsonMap) {
          if (j != modelInfo.timeStampColumn) {
            asJson[modelInfo.dbToJsonMap[j]] = valueArrays[i].averages[modelInfo.dbToJsonMap[j]];
          }
        }
        outputJson.push(asJson);
      }
    }
    
    return outputJson;
  },

  guardianMetaCPU: function(req, res, dbMeta, modelInfo) {

    if (!util.isArray(dbMeta)) { dbMeta = [dbMeta]; }

    var valueArrays = this.constructValueArrays(req.rfcx.limit, dbMeta, modelInfo);

    var jsonArray = [];

    for (i in dbMeta) {

      var dbRow = dbMeta[i];

      jsonArray.push({
        measured_at: dbMeta[i].measured_at,
        percent_usage: dbMeta[i].cpu_percent,
        clock_speed: dbMeta[i].cpu_clock
      });

      valueArrays = this.populateValueArrays(valueArrays, dbMeta[i], modelInfo);
      
    }
    
    valueArrays = this.generateValueArrayAverages(valueArrays, modelInfo);

    
    console.log(this.finalizeValueArraysForOutput(valueArrays, modelInfo));

    return jsonArray;
  }

};

