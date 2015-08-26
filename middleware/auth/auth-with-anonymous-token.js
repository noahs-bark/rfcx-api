var models  = require("../../models");
var hash = require("../../misc/hash.js").hash;

exports.authenticateAs = function(req,token,done,authUser){

  models.AnonymousToken
    .findOne({ 
      where: {
        guid: authUser.guid
      }
    }).then(function(dbToken){
      if (dbToken == null) {
        
        return done(null, false, {message:"invalid user/token combination"});

      } else if (dbToken.auth_token_expires_at.valueOf() <= new Date()) {
        
        dbToken.destroy().then(function(){
          return done(null, false, {message:"token is expired"});
        }).catch(function(err){
          console.log("failed to delete anonymous token, but proceeding anyway... | "+err);
          return done(null, false, {message:"token is expired"});
        });

      } else if (   (dbToken.auth_token_hash == hash.hashedCredentials(dbToken.auth_token_salt,token)) 
                &&  (   (dbToken.only_allow_access_to == null)
                    ||  (dbToken.only_allow_access_to.split("|").indexOf(req.rfcx.url_path) > -1)
                    )
                ) {

        req.rfcx.auth_token_info = {
          type: "anonymous",
          id: dbToken.id,
          guid: dbToken.guid
        };

        console.log("authenticated with anonymous token: "+req.rfcx.auth_token_info.guid);
        
        return done(null,req.rfcx.auth_token_info);
            
      } else {
        console.log("failed to match token with salted hash");
        return done(null, false, {message:"invalid user/token combination"});
      }
    }).catch(function(err){
      console.log("failed to find anonymous token | "+err);
      return done(err);
    });
};

