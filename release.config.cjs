/**
 * @type {import('semantic-release').GlobalConfig}
 */
module.exports = {
  repositoryUrl: "https://code.quickbasic.org/sigitex/weapon.git",
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/exec", {
      prepareCmd: "npm pkg set version=${nextRelease.version}",
      publishCmd: "npm publish --access public",
    }],
    "@markwylde/semantic-release-gitea",
  ],
};
