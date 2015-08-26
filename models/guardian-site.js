"use strict";

module.exports = function(sequelize, DataTypes) {
  var GuardianSite = sequelize.define("GuardianSite", {
    guid: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
      }
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: false,
      validate: {
      }
    },
    description: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: false,
      validate: {
      }
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      validate: {
      }
    },
  }, {
    classMethods: {
      associate: function(models) {
        GuardianSite.hasMany(models.Guardian, {as: "Guardian", foreignKey: "site_id"});
        GuardianSite.hasMany(models.GuardianCheckIn, {as: "CheckIn", foreignKey: "site_id"});
        GuardianSite.hasMany(models.GuardianAudio, {as: "Audio", foreignKey: "site_id"});
      },
      indexes: [
        {
          unique: true,
          fields: ["guid"]
        }
      ]
    }
  });

  return GuardianSite;
};