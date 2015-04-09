var verbose_logging = (process.env.NODE_ENV !== "production");
var models  = require("../../models");
var express = require("express");
var router = express.Router();
var fs = require("fs");
var util = require("util");
var querystring = require("querystring");
var hash = require("../../misc/hash.js").hash;
var aws = require("../../config/aws.js").aws();
var guardianSoftware = require("../../data_storage/guardian-software.js");
var fileKeeper = require("../../file_storage/file-keeper.js");

// get the latest released version of the guardian software
// (primarily for guardians who are checking for updates)
router.route("/:guardian_id/software/latest")
  .get(function(req,res) {

    models.Guardian
      .findOrCreate({ where: { guid: req.params.guardian_id } })
      .spread(function(dbGuardian, wasCreated){
        dbGuardian.last_update_check_in = new Date();
        dbGuardian.update_check_in_count = 1+dbGuardian.update_check_in_count;
        dbGuardian.save();

        models.GuardianSoftware
          .findAll({ where: { is_available: true }, order: "release_date DESC", limit: 2 })
          .then(function(dSoftware){
            console.log("software version check by guardian '"+dbGuardian.guid+"'");
            var softwareJson = [];
            for (i in dSoftware) {
              softwareJson[i] = {
                versionNumber: dSoftware[i].number,
                releaseDate: dSoftware[i].release_date.toISOString(),
                sha1: dSoftware[i].sha1_checksum,
                url: 
                  (process.env.NODE_ENV !== "development") ? dSoftware[i].url : "http://192.168.0.62:8080/apk/"+dSoftware[i].number+".apk"
                
              };
            }
            res.status(200).json(softwareJson);
          }).catch(function(err){
            res.status(500).json({msg:"error finding latest software version"});
          });

      });
  })
;

router.route("/upload/software")
  .get(function(req,res) {
})
;

// submit a new APK guardian software file
// (primarily for admin use, when releasing a new software version)
router.route("/upload/software")
  .post(function(req,res) {
  	if(!req.body.software_version){
  	  res.status(500).json({msg:"a software version must be specified"});
  	  return;
  	}
  	hash.fileSha1Async(req.files.software ? req.files.software.path : null)
  	.then(function(fileHash){
      return guardianSoftware.upsertGuardianSoftware(req.body.software_version, fileHash)
    })
    .then(function(gs) {
      //if a file was uploaded
      if(req.files.software && req.files.software.path) {
  		  fileKeeper.putFile(req.files.software.path, "rfcx-development", req.body.software_version+".apk")
  		  .then(function(fkRes){
      	  //remove temporarily uploaded file
      	  fs.unlink(req.files.software.path,function(e){if(e){console.log(e);}});
      	  if (200 == fkRes.statusCode) {
      	    res.status(200).json({msg:"success"}); 
      	  } else {
      	    res.status(500).json({msg:"file keeper error storing guardian software file: " + fkRes.msg});
      	  }
      	})
      	.done()
    	} else {
    	  res.status(200).json({msg:"success"});
    	}
  	}).catch(function(err){
      res.status(500).json({msg:"error submitting guardian software file: " + err.message});
    });
  })
;   

module.exports = router;