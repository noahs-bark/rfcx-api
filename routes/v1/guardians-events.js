var verbose_logging = (process.env.NODE_ENV !== "production");
var models  = require("../../models");
var express = require("express");
var router = express.Router();
var querystring = require("querystring");
var hash = require("../../misc/hash.js").hash;
var aws = require("../../misc/aws.js").aws();
var passport = require("passport");
passport.use(require("../../middleware/auth/passport-token.js").TokenStrategy);

router.route("/:guardian_id/alerts")
  .post(passport.authenticate("token",{session:false}), function(req,res) {

    console.log(req.body);
    // try {
    //     var json = JSON.parse(querystring.parse("all="+req.body.json).all);
    //     if (verbose_logging) { console.log(json); }
    // } catch (e) {
    //     console.log(e);
    // }

    // models.Guardian
    //   .findOrCreate({ where: { guid: req.params.guardian_id } })
    //   .spread(function(dbGuardian, wasCreated){
        
    //     console.log(dbGuardian.guid);

        res.status(200).json({msg:"nothing happens at this endpoint for the moment"});

        // models.GuardianAlert
        //   .findOrCreate({ where: { incident_key: req.params.guardian_id } })
        //   .then(function(dSoftware){
        //     console.log("software version check by guardian '"+dbGuardian.guid+"'");
        //     var softwareJson = [];
        //     for (i in dSoftware) {
        //       softwareJson[i] = {
        //         versionNumber: dSoftware[i].number,
        //         releaseDate: dSoftware[i].release_date.toISOString(),
        //         sha1: dSoftware[i].sha1_checksum,
        //         url: dSoftware[i].url
        //       };
        //     }
        //     res.status(200).json(softwareJson);
        //   }).catch(function(err){
        //     res.status(500).json({msg:"error finding latest software version"});
        //   });

 //     });
  })
;


module.exports = router;
