module.exports = {
  "cwd": "/github/workspace",
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/git",
    "@semantic-release/github",
    [
      "@semantic-release/exec",
      {
        "publishCmd": "echo ${nextRelease.version} > version.txt"
      }
    ]
  ],
  "branches": [
    process.env.BRANCH_NAME
  ]
}