const core = require("@actions/core");
const github = require("@actions/github");
const semver = require("semver");

const Options = {
  token: "",
  keepCount: 3,
  keepOld: true,
  keepOldBy: 2, // major: 1, minor: 2, patch: 3
  keepOldCount: 1,
  removeTags: false,
  dryRun: false,
  versionPrefix: "",
};

const SemverOption = {
  loose: false,
  includePrerelease: false,
};

function formatSemver(str) {
  const reg = /^v?\d+(\.?\d+)?(\.?\d+)?/;
  const match = str.match(reg);
  if (!match) return str;
  let match_str = match[0];
  let levels = match_str.split(".").length - 1;
  while (levels < 2) {
    match_str += ".0";
    levels++;
  }
  return str.replace(match[0], match_str);
}

async function getReleaseListFromGithub(owner, repo, page, outputObj) {
  const octokit = github.getOctokit(Options.token);
  try {
    var { data } = await octokit.rest.repos.listReleases({
      owner: owner,
      repo: repo,
      per_page: 100,
      page: page,
    });
  } catch (error) {
    core.setFailed(`${error.name}: ${error.message}`);
  }
  for (const release of data) {
    // Filter releases by version prefix
    if (release.tag_name.startsWith(Options.versionPrefix) || Options.versionPrefix === "") {
      outputObj[release.tag_name] = release.id;
    }
  }
  console.log(`Page: ${page}, length: ${data.length}`);
  if (data.length === 100) {
    await getReleaseListFromGithub(owner, repo, page + 1, outputObj);
  }
}

function parseReleaseTreeFromList(releases, outputObj) {
  for (const tag_name in releases) {
    if (tag_name.startsWith(Options.versionPrefix) || Options.versionPrefix === "") {
      // remove prefix from the tag name
      const new_tag_name = tag_name.replace(Options.versionPrefix, "");

      const version = semver.parse(
      semver.valid(new_tag_name) || formatSemver(new_tag_name),
      SemverOption
      );
      // check if parse success
      if (!version) {
        // skip if version is unparseable
        console.log(`Skipped unparseable version: ${new_tag_name}`);
        continue;
      }
      else { 
        console.log(`Parsed version: ${new_tag_name}`);
      }

      const major_str = version.major.toString();
      const minor_str = version.minor.toString();
      const patch_str = version.patch.toString();

      switch (Options.keepOldBy) {
        case 1:
          if (!outputObj.hasOwnProperty(major_str)) outputObj[major_str] = [];

          outputObj[major_str].push({
            id: releases[new_tag_name],
            version: new_tag_name,
          });
          break;
        case 2:
          if (!outputObj.hasOwnProperty(major_str)) {
            outputObj[major_str] = {};
          }
          if (!outputObj[major_str].hasOwnProperty(minor_str)) {
            outputObj[major_str][minor_str] = [];
          }

          outputObj[major_str][minor_str].push({
            id: releases[new_tag_name],
            version: new_tag_name,
          });
          break;
        case 3:
          if (!outputObj.hasOwnProperty(major_str)) {
            outputObj[major_str] = {};
          }
          if (!outputObj[major_str].hasOwnProperty(minor_str)) {
            outputObj[major_str][minor_str] = {};
          }
          if (!outputObj[major_str][minor_str].hasOwnProperty(patch_str))
            outputObj[major_str][minor_str][patch_str] = [];

          outputObj[major_str][minor_str][patch_str].push({
            id: releases[new_tag_name],
            version: new_tag_name,
          });
          break;
      }
    }
    else {
      console.log(`Skipped release: ${tag_name}`);
    }
  }
}

function sortSemverInTreeList(treeList) {
  treeList.sort((a, b) => {
    if (
      semver.lt(
        semver.valid(a.version) || formatSemver(a.version),
        semver.valid(b.version) || formatSemver(b.version),
        SemverOption
      )
    )
      return 1;
    else return -1;
  });
}

function getLatestReleasesToKeep(release_tree) {
  const ver_numbers = [];
  for (const ver_number in release_tree) {
    ver_numbers.push(ver_number);
  }
  ver_numbers.sort((a, b) => {
    return Number(b) - Number(a);
  });
  if (ver_numbers.length != 0){
    const latest_ver = release_tree[ver_numbers[0]];
    if (Array.isArray(latest_ver)) {
      sortSemverInTreeList(latest_ver);
      const releases_to_keep = latest_ver.slice(0, Options.keepCount);
      releases_to_keep.forEach((ele, idx, arr) => {
        arr[idx] = ele.version;
      });
      delete release_tree[ver_numbers[0]];
      return releases_to_keep;
    } else {
      return getLatestReleasesToKeep(latest_ver);
    }
  }
  else {
    return [];
  }
}

function getOldReleasesToKeep(release_tree, outKeepList) {
  for (const ver_number in release_tree) {
    const ver_level = release_tree[ver_number];
    if (Array.isArray(ver_level)) {
      sortSemverInTreeList(ver_level);
      const releases_to_keep = ver_level.slice(0, Options.keepOldCount);
      releases_to_keep.forEach((ele, idx, arr) => {
        arr[idx] = ele.version;
      });
      outKeepList.push(...releases_to_keep);
    } else {
      getOldReleasesToKeep(ver_level, outKeepList);
    }
  }
}

function delReleasesFromList(releaseTree, outReleaseList) {
  const releasesToKeep = [];
  // list latest major release to keep then remove them from release list
  releasesToKeep.push(...getLatestReleasesToKeep(releaseTree));

  if (Options.keepOld) {
    getOldReleasesToKeep(releaseTree, releasesToKeep);
  }

  // Remove releases to keep from the release list
  releasesToKeep.forEach((ver) => {
    if (Options.versionPrefix !== ""){
      ver = Options.versionPrefix + ver;
    }
    delete outReleaseList[ver];
  });

  console.log("Tags to keep:");
  console.log(releasesToKeep);
}

async function deleteReleasesFromGithub(owner, repo, releases) {
  const octokit = github.getOctokit(Options.token);
  const promises = [];
  const tags = [];
  for (const version in releases) {
    const res = octokit.rest.repos.deleteRelease({
      owner: owner,
      repo: repo,
      release_id: releases[version],
    });
    promises.push(res);
    tags.push(version);
  }
  await Promise.allSettled(promises).then((results) =>
    results.forEach((result, idx) => {
      if (result.status === "rejected")
        console.log(
          `Failed to delete release: ${tags[idx]}, reason: ${result.reason}`
        );
      if (result.status === "fulfilled")
        console.log(`Deleted release: ${tags[idx]}.`);
    })
  );
}

async function deleteTagsFromGithub(owner, repo, releases) {
  const octokit = github.getOctokit(Options.token);
  const promises = [];
  const tags = [];
  for (const version in releases) {
    const res = octokit.rest.git.deleteRef({
      owner: owner,
      repo: repo,
      ref: `tags/${version}`,
    });
    promises.push(res);
    tags.push(version);
  }
  await Promise.allSettled(promises).then((results) =>
    results.forEach((result, idx) => {
      if (result.status === "rejected")
        console.log(
          `Failed to delete tag: ${tags[idx]}, reason: ${result.reason}`
        );
      if (result.status === "fulfilled")
        console.log(`Deleted tag: ${tags[idx]}.`);
    })
  );
}

async function run() {
  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const releases = {};
  console.log("Getting releases from Github.");
  await getReleaseListFromGithub(owner, repo, 1, releases);
  console.log("Done.");

  if (Object.keys(releases).length === 0) {
    console.log("This repo doesn't have any releases.");
    return;
  }

  const release_tree = {};
  console.log("Parsing the release tree.");
  parseReleaseTreeFromList(releases, release_tree);
  console.log("Done.");

  console.log("Calculating releases to delete.");
  delReleasesFromList(release_tree, releases);

  if (Object.keys(releases).length === 0) {
    console.log("No tags to delete");
    return;
  }

  console.log("Tags to delete:");
  console.log(releases);
  console.log("Done.");

  console.log("Deleting releases from Github.");
  if (!Options.dryRun) await deleteReleasesFromGithub(owner, repo, releases);
  console.log("Done.");

  if (Options.removeTags) {
    console.log("Deleting tags from Github.");
    if (!Options.dryRun) await deleteTagsFromGithub(owner, repo, releases);
    console.log("Done.");
  }
}

try {
  // load options
  Options.token = core.getInput("token", {required: true});
  Options.keepCount = Number(core.getInput("keep-count"));
  Options.keepOld = core.getBooleanInput("keep-old-minor-releases", {required: true});
  Options.keepOldBy =
    core.getInput("keep-old-minor-releases-by") === "major"
      ? 1
      : core.getInput("keep-old-minor-releases-by") === "patch"
      ? 3
      : 2;
  Options.keepOldCount = Number(core.getInput("keep-old-minor-releases-count"));
  Options.removeTags = core.getBooleanInput("remove-tags");
  Options.dryRun = core.getBooleanInput("dry-run");
  // version prefix
  Options.versionPrefix = core.getInput("version-prefix");
  SemverOption.loose = core.getBooleanInput("semver-loose");
  SemverOption.includePrerelease = core.getBooleanInput("include-prerelease");
  if (isNaN(Options.keepCount))
    throw new Error("Input is not a number: keep-count")
  if (isNaN(Options.keepOldCount))
    throw new Error("Input is not a number: keep-old-minor-releases-count")

  run();
} catch (error) {
  core.setFailed(`${error.name}: ${error.message}`);
}
