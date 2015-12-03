var verbose_logging = (process.env.NODE_ENV !== "production");
var models  = require("../../models");
var express = require("express");
var router = express.Router();
var querystring = require("querystring");
var fs = require("fs");
var zlib = require("zlib");
var exifTool = require("exiftool");
var util = require("util");
var hash = require("../../utils/misc/hash.js").hash;
var token = require("../../utils/internal-rfcx/token.js").token;
var aws = require("../../utils/external/aws.js").aws();
var views = require("../../views/v1");
var checkInHelpers = require("../../utils/rfcx-checkin");
var httpError = require("../../utils/http-errors.js");
var passport = require("passport");
passport.use(require("../../middleware/passport-token").TokenStrategy);

router.route("/:guardian_id/checkins")
  .post(passport.authenticate("token",{session:false}), function(req,res) {

    var requestStartTime = (new Date()).valueOf();

    zlib.unzip(
      new Buffer(querystring.parse("gzipped="+req.body.meta).gzipped,"base64"),
      function(zLibError,zLibBuffer){
      if (!zLibError) {

        var json = JSON.parse(zLibBuffer.toString());
        if (verbose_logging) { console.log(json); }
        
        // retrieve the guardian from the database
        models.Guardian
          .findOne({ 
            where: { guid: req.params.guardian_id }
        }).then(function(dbGuardian){

          dbGuardian.last_check_in = new Date();
          dbGuardian.check_in_count = 1+dbGuardian.check_in_count;
          dbGuardian.save();

          // organize geo-location data parameters
          var metaGeo = [
              ((json.location[0] != null) ? parseFloat(json.location[0]) : null),
              ((json.location[1] != null) ? parseFloat(json.location[1]) : null),
              ((json.location[2] != null) ? parseFloat(json.location[2]) : null)
            ];

          // add a new checkin to the database
          models.GuardianCheckIn
            .create({
              guardian_id: dbGuardian.id,
              site_id: dbGuardian.site_id,
              measured_at: timeStampToDate(json.measured_at, json.timezone_offset),
              queued_at: timeStampToDate(json.queued_at, json.timezone_offset),
              guardian_queued_checkins: parseInt(json.queued_checkins),
              guardian_skipped_checkins: parseInt(json.skipped_checkins),
              location_latitude: metaGeo[0],
              location_longitude: metaGeo[1],
              location_precision: metaGeo[2],
              is_certified: dbGuardian.is_certified
          }).then(function(dbCheckIn){

            // template for json return... to be populated as we progress
            var returnJson = {
              checkin_id: dbCheckIn.guid, // unique guid of the check-in
              audio: [], // array of audio files successfully ingested
              screenshots: [], // array of screenshot images successfully ingested
              messages: [], // array of sms messages successfully ingested
              instructions: {
                prefs: {},
                messages: [] // array of sms messages that the guardian should send
              }
            };

            // save guardian meta data
            checkInHelpers.saveMeta.DataTransfer(strArrToJSArr(json.data_transfer,"|","*"), dbGuardian.id, dbCheckIn.id);
            checkInHelpers.saveMeta.CPU(strArrToJSArr(json.cpu,"|","*"), dbGuardian.id, dbCheckIn.id);
            checkInHelpers.saveMeta.Battery(strArrToJSArr(json.battery,"|","*"), dbGuardian.id, dbCheckIn.id);
            checkInHelpers.saveMeta.Power(strArrToJSArr(json.power,"|","*"), dbGuardian.id, dbCheckIn.id);
            checkInHelpers.saveMeta.Network(strArrToJSArr(json.network,"|","*"), dbGuardian.id, dbCheckIn.id);
            checkInHelpers.saveMeta.Offline(strArrToJSArr(json.offline,"|","*"), dbGuardian.id, dbCheckIn.id);
            checkInHelpers.saveMeta.LightMeter(strArrToJSArr(json.lightmeter,"|","*"), dbGuardian.id, dbCheckIn.id);

            // save software role versions
            checkInHelpers.saveMeta.SoftwareRoleVersion(strArrToJSArr(json.software,"|","*"), dbGuardian.id);

            // parse, review and save sms messages
            var messageInfo = checkInHelpers.messages.buildInfo(json.messages, dbGuardian.id, dbCheckIn.id, json.timezone_offset);
            for (msgInfoInd in messageInfo) {
              checkInHelpers.messages.save(messageInfo[msgInfoInd])
                .then(function(dbMsg){
                  messageInfo[dbMsg.android_id].isSaved = true;
                  messageInfo[dbMsg.android_id].guid = dbMsg.guid;
                });
            }
            // add messages instructions
            // returnJson.instructions.messages.push({
            //   body: "From  "+dbGuardian.guid,
            //   address: "+14153359205",
            //   guid: "guid goes here"
            // });

            // if included, update previous checkIn info
            if (json.previous_checkins != null) {
              var previousCheckIns = strArrToJSArr(json.previous_checkins,"|","*");
              for (prvChkInInd in previousCheckIns) {
                models.GuardianCheckIn
                  .findOne({
                    where: { guid: previousCheckIns[prvChkInInd][0] }
                  }).then(function(dPreviousCheckIn){
                    dPreviousCheckIn.request_latency_guardian = previousCheckIns[prvChkInInd][1];
                    dPreviousCheckIn.save();
                  }).catch(function(err){
                    console.log("error finding/updating previous checkin id: "+previousCheckIns[prvChkInInd][0]);
                  });
              }
            }

            // save screenshot files
            if (!!req.files.screenshot) {
              var screenShotInfo = {};
              if (!util.isArray(req.files.screenshot)) { req.files.screenshot = [req.files.screenshot]; }
                for (i in req.files.screenshot) {
                  // this next line assumes there is only one screenshot attached
                  // ...so this should probably be updated to work like the rest of this section
                  var screenShotMeta = json.screenshots.split("|")[0].split("*");
                  var timeStamp = req.files.screenshot[i].originalname.substr(0,req.files.screenshot[i].originalname.lastIndexOf(".png"));
                  var dateString = (new Date(parseInt(timeStamp))).toISOString().substr(0,19).replace(/:/g,"-");
                  screenShotInfo[timeStamp] = {
                     guardian_id: dbGuardian.guid,
                     checkin_id: dbCheckIn.guid,
                     screenshot_id: null, 
                     version: null, // to be decided whether this is important to include here...
                     uploadLocalPath: req.files.screenshot[i].path,
                     size: fs.statSync(req.files.screenshot[i].path).size,
                     sha1Hash: hash.fileSha1(req.files.screenshot[i].path),
                     guardianSha1Hash: screenShotMeta[3],
                     origin_id: timeStamp,
                     timeStamp: timeStampToDate(timeStamp, json.timezone_offset),
                     isSaved: false,
                     s3Path: "/screenshots/"+process.env.NODE_ENV
                              +"/"+dateString.substr(0,7)+"/"+dateString.substr(8,2)
                              +"/"+dbGuardian.guid
                              +"/"+dbGuardian.guid+"-"+dateString+".png"
                  };

                }
                for (j in screenShotInfo) {

                  if (screenShotInfo[j].sha1Hash === screenShotInfo[j].guardianSha1Hash) {

                    aws.s3(process.env.ASSET_BUCKET_META).putFile(
                      screenShotInfo[j].uploadLocalPath, screenShotInfo[j].s3Path, 
                      function(err, s3Res){
                        try { s3Res.resume(); } catch (resumeErr) { console.log(resumeErr); }
                        if (!!err) {
                          console.log(err);
                        } else if (200 == s3Res.statusCode) {
                          for (l in screenShotInfo) {
                            if (aws.s3ConfirmSave(s3Res,screenShotInfo[l].s3Path)) {
                              
                              fs.unlink(screenShotInfo[l].uploadLocalPath,function(e){if(e){console.log(e);}});

                              models.GuardianMetaScreenShot.create({
                                  guardian_id: dbGuardian.id,
                                  captured_at: screenShotInfo[l].timeStamp,
                                  size: screenShotInfo[l].size,
                                  sha1_checksum: screenShotInfo[l].sha1Hash,
                                  url: screenShotInfo[l].s3Path
                                }).then(function(dbGuardianMetaScreenShot){
                                    // if all goes well, then report it on the "global" object...
                                    screenShotInfo[l].isSaved = true;
                                    screenShotInfo[l].screenshot_id = dbGuardianMetaScreenShot.guid;
                                    console.log("screenshot saved: "+screenShotInfo[l].timeStamp);
                                }).catch(function(err){
                                  console.log("error saving screenshot: "+screenShotInfo[l].timeStamp+err);
                                });
                            }
                          }                        
                        }
                    });

                  } else {
                    // even if checksum fails, we still (at least for now) want
                    // to instruct to the guardian to delete the screenshot and move on
                    screenShotInfo[j].isSaved = true;
                    fs.unlink(screenShotInfo[j].uploadLocalPath,function(e){if(e){console.log(e);}});
                  }

                }
            }

            // add prefs instructions as set in database
            for (guardianInd in dbGuardian.dataValues) {
              if ((guardianInd.substr(0,6) === "prefs_") && (dbGuardian.dataValues[guardianInd] != null)) {
           //     returnJson.instructions.prefs[guardianInd.substr(6)] = dbGuardian.dataValues[guardianInd];
              }
            }
      

            // save audio files
            if (!!req.files.audio) {
              if (!util.isArray(req.files.audio)) { req.files.audio = [req.files.audio]; }
              var audioMeta = [];
              if (json.audio != null) { audioMeta = json.audio.split("|"); }
              if (audioMeta.length == req.files.audio.length) {
                var audioInfo = {};
                for (i in req.files.audio) {
                  audioMeta[i] = audioMeta[i].split("*");
                  var timeStampIndex = audioMeta[i][1]; 
                  audioMeta[i][1] = timeStampToDate(audioMeta[i][1], json.timezone_offset); 
                  var dateString = audioMeta[i][1].toISOString().substr(0,19).replace(/:/g,"-");
                  audioInfo[timeStampIndex] = {
                    guardian_id: dbGuardian.guid,
                    checkin_id: dbCheckIn.guid,
                    version: null, // to be decided whether this is important to include here...
                    battery_temperature: null,
                    guardianSha1Hash: audioMeta[i][3],
                    uploadLocalPath: req.files.audio[i].path,
                    unzipLocalPath: req.files.audio[i].path.substr(0,req.files.audio[i].path.lastIndexOf("."))+"."+audioMeta[i][2],
                    size: null, // to be calculated following the uncompression
                    sha1Hash: null, // to be calculated following the uncompression
                    duration: null,
                    timeStamp: timeStampIndex,
                    measured_at: audioMeta[i][1],
                    api_token_guid: null,
                    api_token: null,
                    api_token_expires_at: null,
                    api_url: null,
                    isSaved: { db: false, s3: false, sqs: false },
                    s3Path: "/"+process.env.NODE_ENV
                            +"/"+dateString.substr(0,7)+"/"+dateString.substr(8,2)
                            +"/"+dbGuardian.guid
                            +"/"+dbGuardian.guid+"-"+dateString+"."+audioMeta[i][2]
                  };
                }

                for (j in audioInfo) {
                  
                  // unzip uploaded audio file into upload directory
                  audioInfo[j].unZipStream = fs.createWriteStream(audioInfo[j].unzipLocalPath);
                  fs.createReadStream(audioInfo[j].uploadLocalPath).pipe(zlib.createGunzip()).pipe(audioInfo[j].unZipStream);
                  // when the output stream closes, proceed asynchronously...
                  audioInfo[j].unZipStream.on("close", function(){
                    // fill in the file info on the unzipped audio file
                    audioInfo[j].sha1Hash = hash.fileSha1(audioInfo[j].unzipLocalPath);
                    audioInfo[j].size = fs.statSync(audioInfo[j].unzipLocalPath).size;
                    // compare to checksum received from guardian
                    if (audioInfo[j].sha1Hash === audioInfo[j].guardianSha1Hash) {

                      // if it matches, add the audio to the database
                      models.GuardianAudio.create({
                        guardian_id: dbGuardian.id,
                        site_id: dbGuardian.site_id,
                        check_in_id: dbCheckIn.id,
                        sha1_checksum: audioInfo[j].sha1Hash,
                        url: "s3://"+process.env.ASSET_BUCKET_AUDIO+audioInfo[j].s3Path,
                        size: audioInfo[j].size,
                        duration: audioInfo[j].duration,
                        measured_at: audioInfo[j].measured_at
                      }).then(function(dbAudio){
                        // because the callback is asynchronous...
                        // cycle through all uploaded audio options and match the checksum
                        // ...in order to re-find our place
                        for (k in audioInfo) {
                          if (audioInfo[k].sha1Hash === dbAudio.sha1_checksum) {

                            // parse exif data from file and save to db
                            fs.readFile(audioInfo[k].unzipLocalPath,function(err,audioFileData){
                              if (!!err) { throw err;
                              } else {
                                exifTool.metadata(audioFileData,function(err,audioFileExifData){
                                  if (!!err) { throw err;
                                  } else {
                                    dbAudio.duration = (((parseInt(audioFileExifData.duration.split(":")[0])*3600)+(parseInt(audioFileExifData.duration.split(":")[1])*60)+parseInt(audioFileExifData.duration.split(":")[2]))*1000);
                                    dbAudio.capture_format = audioFileExifData.audioFormat;
                                    dbAudio.capture_bitrate = Math.round(parseFloat(audioFileExifData.avgBitrate.substr(0,audioFileExifData.avgBitrate.indexOf(" kbps")))*1000/128)*128;
                                    dbAudio.capture_sample_rate = parseInt(audioFileExifData.audioSampleRate);
                                    dbAudio.save();
                                  }
                                });
                              }
                            });
                            
                            // inform other async processes that this one has been saved to database
                            audioInfo[k].isSaved.db = true;
                            audioInfo[k].audio_id = dbAudio.guid;
                            audioInfo[k].api_url = "/v1/guardians/"+dbGuardian.guid+"/checkins/"+dbCheckIn.guid+"/audio/"+dbAudio.guid+"/events";

                            aws.s3(process.env.ASSET_BUCKET_AUDIO).putFile(
                              audioInfo[k].unzipLocalPath, audioInfo[k].s3Path, 
                              function(err, s3Res){
                                try { s3Res.resume(); } catch (resumeErr) { console.log(resumeErr); }
                                if (!!err) {
                                  console.log(err);
                                } else if (200 == s3Res.statusCode) {
                                  for (l in audioInfo) {
                                    if (aws.s3ConfirmSave(s3Res,audioInfo[l].s3Path)) {
                                      audioInfo[l].isSaved.s3 = true;

                                      audioInfo[l].measured_at = audioInfo[l].measured_at.toISOString();
                                      
                                      token.createAnonymousToken({
                                        reference_tag: audioInfo[l].audio_id,
                                        token_type: "analysis-worker",
                                        created_by: "guardian-checkin",
                                        minutes_until_expiration: 180,
                                        allow_garbage_collection: true,
                                        only_allow_access_to: [ "^"+audioInfo[l].api_url+"$" ]
                                      }).then(function(tokenInfo){

                                        for (m in audioInfo) {
                                          if (audioInfo[m].audio_id == tokenInfo.reference_tag) {

                                            audioInfo[m].api_token_guid = tokenInfo.token_guid;
                                            audioInfo[m].api_token = tokenInfo.token;
                                            audioInfo[m].api_token_expires_at = tokenInfo.token_expires_at;
                                            audioInfo[m].minutes_until_expiration = Math.round((tokenInfo.token_expires_at.valueOf()-(new Date()).valueOf())/60000);
                                            
                                            aws.sns().publish({
                                                TopicArn: aws.snsTopicArn("rfcx-analysis"),
                                                Message: JSON.stringify({
                                                    
                                                    measured_at: audioInfo[m].measured_at,

                                                    api_token_guid: audioInfo[m].api_token_guid,
                                                    api_token: audioInfo[m].api_token,
                                                    api_token_expires_at: audioInfo[m].api_token_expires_at,
                                                    api_url: req.rfcx.api_url_domain+audioInfo[m].api_url,
                                                    audio_url: aws.s3SignedUrl(process.env.ASSET_BUCKET_AUDIO, audioInfo[m].s3Path, audioInfo[m].minutes_until_expiration),
                                                    audio_sha1: audioInfo[m].sha1Hash
                                                  })
                                              }, function(snsErr, snsData) {

                                                if (!!snsErr && !aws.snsIgnoreError()) {
                                                  console.log(snsErr);
                                                } else {

                                                  dbAudio.analysis_queued_at = new Date();
                                                  dbAudio.save();
                                                  
                                                  var isComplete = true;

                                                  for (n in audioInfo) {
                                                    if (!audioInfo[n].isSaved.sqs) { isComplete = false; }
                                                    returnJson.audio.push({
                                                      id: n,
                                                      guid: audioInfo[n].audio_id
                                                    });         
                                                  }
                                                  for (o in screenShotInfo) {
                                                    if (screenShotInfo[o].isSaved) {
                                                      returnJson.screenshots.push({
                                                        id: o,
                                                        guid: screenShotInfo[o].screenshot_id
                                                      });
                                                    }         
                                                  }
                                                  for (p in messageInfo) {
                                                    if (messageInfo[p].isSaved) {
                                                      returnJson.messages.push({
                                                        id: messageInfo[p].android_id,
                                                        guid: messageInfo[p].guid
                                                      });
                                                    }         
                                                  }
                                                  if (isComplete) {

                                                    dbCheckIn.request_latency_api = (new Date()).valueOf()-requestStartTime;
                                                    dbCheckIn.save();

                                                    if (verbose_logging) { console.log(returnJson); }
                                                    res.status(200).json(returnJson);
                                                    
                                                    for (q in audioInfo) { audioInfo[q].isSaved.sqs = false; }
                                                  }
                                                }
                                            });
                                            fs.unlink(audioInfo[m].uploadLocalPath,function(e){if(e){console.log(e);}});
                                            fs.unlink(audioInfo[m].unzipLocalPath,function(e){if(e){console.log(e);}});
                                            audioInfo[m].isSaved.sqs = true;

                                          }  
                                        }
                                      }).catch(function(err){
                                        console.log("error creating access token for analysis worker | "+err);
                                        dbCheckIn.destroy().then(function(){ console.log("deleted incomplete checkin entry"); }).catch(function(err){ console.log("failed to delete incomplete checkin entry | "+err); });
                                        dbAudio.destroy().then(function(){ console.log("deleted incomplete checkin entry"); }).catch(function(err){ console.log("failed to delete incomplete checkin entry | "+err); });
                                        if (!!err) { res.status(500).json({msg:"error creating access token for analysis worker"}); }
                                      });
                                    }
                                  }
                                }
                            });
                          }
                        }
                      }).catch(function(err){
                        console.log("error adding audio to database | "+err);
                        dbCheckIn.destroy().then(function(){ console.log("deleted incomplete checkin entry"); }).catch(function(err){ console.log("failed to delete incomplete checkin entry | "+err); });
                        models.GuardianAudio.findOne({ where: { sha1_checksum: audioInfo[j].sha1Hash } }).then(function(dbAudio){ dbAudio.destroy().then(function(){ console.log("deleted incomplete audio entry"); }); }).catch(function(err){ console.log("failed to delete incomplete audio entry | "+err); });
                        if (!!err) { res.status(500).json({msg:"error adding audio to database"}); }
                      });
                    } else {
                      console.log("checksum mismatch on uploaded (and unzipped) audio file | "+audioInfo[j].sha1Hash + " - " + audioInfo[j].guardianSha1Hash);
                      dbCheckIn.destroy().then(function(){ console.log("deleted incomplete checkin entry"); }).catch(function(err){ console.log("failed to delete incomplete checkin entry | "+err); });
                      res.status(500).json({msg:"checksum mismatch on uploaded audio file | "+audioInfo[j].sha1Hash + " - " + audioInfo[j].guardianSha1Hash});
                    }
                  });
                }
              } else {
                console.log("couldn't match audio meta to uploaded content | "+audioMeta);
                dbCheckIn.destroy().then(function(){ console.log("deleted incomplete checkin entry"); }).catch(function(err){ console.log("failed to delete incomplete checkin entry | "+err); });
                if (!!err) { res.status(500).json({msg:"couldn't match audio meta to uploaded content"}); }
              }
            } else {
              console.log("no audio files detected");
              dbCheckIn.request_latency_api = (new Date()).valueOf()-requestStartTime;
              dbCheckIn.save();
              res.status(200).json(returnJson);
            }

          }).catch(function(err){
            console.log("error adding checkin to database | "+err);
            if (!!err) { res.status(500).json({msg:"error adding checkin to database"}); }
          });
      }).catch(function(err){
        console.log("failed to find guardian | "+err);
        if (!!err) { res.status(404).json({msg:"failed to find guardian"}); }
      });
    } else {
      console.log("failed to parse gzipped json | "+zLibError);
      if (!!zLibError) { res.status(500).json({msg:"failed to parse gzipped json"}); }
    }
    });
  })
;

router.route("/:guardian_id/checkins")
  .get(passport.authenticate("token",{session:false}), function(req,res) {

    models.Guardian
      .findOne({ 
        where: { guid: req.params.guardian_id }
      }).then(function(dbGuardian){

        var dbQuery = { guardian_id: dbGuardian.id };
        var dateClmn = "measured_at";
        if ((req.rfcx.ending_before != null) || (req.rfcx.starting_after != null)) { dbQuery[dateClmn] = {}; }
        if (req.rfcx.ending_before != null) { dbQuery[dateClmn]["$lt"] = req.rfcx.ending_before; }
        if (req.rfcx.starting_after != null) { dbQuery[dateClmn]["$gt"] = req.rfcx.starting_after; }

        models.GuardianCheckIn
          .findAll({ 
            where: dbQuery, 
            include: [ { all: true } ], 
            order: [ [dateClmn, "DESC"] ],
            limit: req.rfcx.limit,
            offset: req.rfcx.offset
          }).then(function(dbCheckIn){

            if (dbCheckIn.length < 1) {
              httpError(res, 404, "database");
            } else {
              views.models.guardianCheckIns(req,res,dbCheckIn)
                .then(function(json){ res.status(200).json(json); });
            }

          }).catch(function(err){
            console.log(err);
            if (!!err) { httpError(res, 500, "database"); }
          });

      }).catch(function(err){
        console.log(err);
        if (!!err) { httpError(res, 500, "database"); }
      });

  })
;

module.exports = router;

function timeStampToDate(timeStamp, LEGACY_timeZoneOffset) {

  var asDate = null;

  // PLEASE MODIFY LATER WHEN WE NO LONGER NEED TO SUPPORT LEGACY TIMESTAMPS !!!!!
  if ((""+timeStamp).indexOf(":") > -1) {
    // LEGACY TIMESTAMP FORMAT
    asDate = new Date(timeStamp.replace(/ /g,"T")+LEGACY_timeZoneOffset);
  } else if (timeStamp != null) {
    
    asDate = new Date(parseInt(timeStamp));
  
  }
  return asDate;
}

// Special Functions

function strArrToJSArr(str,delimA,delimB) {
  if (str == null) { return []; }
  try {
    var rtrnArr = [], arr = str.split(delimA);
    if (arr.length > 0) {
      for (i in arr) {
        rtrnArr.push(arr[i].split(delimB));
      }
      return rtrnArr;
    } else {
      return [];
    }
  } catch(e) {
    console.log(e);
    return [];
  }
}


