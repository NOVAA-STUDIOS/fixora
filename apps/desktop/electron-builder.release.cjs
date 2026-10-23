// Production-only signing overlay. Read credential/config values from the CI environment directly;
// electron-builder's ${env.*} macro expansion does not apply to arbitrary nested signing options.
module.exports = {
  extends: 'electron-builder.yml',
  win: {
    forceCodeSigning: true,
    publisherName: process.env.AZURE_TRUSTED_SIGNING_PUBLISHER,
    azureSignOptions: {
      endpoint: process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
      certificateProfileName: process.env.AZURE_TRUSTED_SIGNING_PROFILE,
      codeSigningAccountName: process.env.AZURE_TRUSTED_SIGNING_ACCOUNT,
      FileDigest: 'SHA256',
      TimestampRfc3161: 'http://timestamp.acs.microsoft.com',
      TimestampDigest: 'SHA256',
    },
  },
};
