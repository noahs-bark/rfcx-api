var verbose_logging = (process.env.NODE_ENV !== "production");
var models  = require("../../models");
var express = require("express");
var router = express.Router();
var views = require("../../views/v1");
var httpError = require("../../utils/http-errors.js");
var passport = require("passport");
passport.use(require("../../middleware/passport-token").TokenStrategy);

router.route("/:guardian_id/meta/:meta_type")
  .get(passport.authenticate("token",{session:false}), function(req,res) {

        var meta_type = req.params.meta_type;

        var modelLookUp = {
            battery: ["GuardianMetaBattery", "guardianMetaBattery", "measured_at"],
            cpu: ["GuardianMetaCPU", "guardianMetaCPU", "measured_at"],
            datatransfer: ["GuardianMetaDataTransfer", "guardianMetaDataTransfer", "ended_at"],
            lightmeter: ["GuardianMetaLightMeter", "guardianMetaLightMeter", "measured_at"],
            network: ["GuardianMetaNetwork", "guardianMetaNetwork", "measured_at"],
            offline: ["GuardianMetaOffline", "guardianMetaOffline", "ended_at"],
            power: ["GuardianMetaPower", "guardianMetaPower", "measured_at"],
            messages: ["GuardianMetaMessage", "guardianMetaMessages", "received_at"],
            checkins: ["GuardianCheckIn", "guardianMetaCheckIns", "measured_at"]
        };

        req.rfcx.limit = (req.query.limit == null) ? 1 : parseInt(req.query.limit);
        if (req.rfcx.limit > 5000) { req.rfcx.limit = 5000; } else if (req.rfcx.limit < 1) { req.rfcx.limit = 1; }

        models.Guardian
          .findOne({ 
            where: { guid: req.params.guardian_id }
        }).then(function(dbGuardian){

            var dbQuery = { guardian_id: dbGuardian.id };
            var dateClmn = modelLookUp[meta_type][2];
            if ((req.rfcx.ending_before != null) || (req.rfcx.starting_after != null)) { dbQuery[dateClmn] = {}; }
            if (req.rfcx.ending_before != null) { dbQuery[dateClmn]["$lt"] = req.rfcx.ending_before; }
            if (req.rfcx.starting_after != null) { dbQuery[dateClmn]["$gt"] = req.rfcx.starting_after; }

            models[modelLookUp[meta_type][0]]
                .findAll({
                    where: dbQuery,
                    order: [ [dateClmn, "DESC"] ],
                    limit: req.rfcx.limit,
                    offset: req.rfcx.offset
                }).then(function(dbMeta){

                    res.status(200).json(views.models[modelLookUp[meta_type][1]](req,res,dbMeta));

                }).catch(function(err){
                    console.log("failure to retrieve meta data: "+err);
                    httpError(res, 500, "database");
                });

        }).catch(function(err){
            console.log("failure to retrieve guardian: "+err);
            httpError(res, 404, "database");
        });
  })
;


module.exports = router;
