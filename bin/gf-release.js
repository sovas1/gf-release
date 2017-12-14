#! /usr/bin/env node

const semver = require('semver');
const taggedVersions = require('tagged-versions');
const inquirer = require('inquirer');
const loudRejection = require('loud-rejection');
const dateFormat = require('dateformat');
const releaseHistory = require('release-history');

const shellEx = require('../lib/helpers/ex').shellEx;
const execSh = require('../lib/helpers/ex').execSh;
const handleError = require('../lib/helpers/handle-error');
const branchesUpToDate = require('../lib/branches-up-to-date');
const bumpVersions = require('../lib/bump-versions');
const spinner = require('../lib/helpers/spinner');
const prompts = require('../lib/prompts');

const config = require('../lib/config').config;
const flags = require('../lib/config').flags;

const getCommits = releaseHistory.getCommits;
const commitsToMd = releaseHistory.commitsToMd;
let currentVersion;
let currentHash;
let newVersion;

loudRejection();

const prependToHistoryFile = (currentHash, newVersion, file) => new Promise(resolve => {
    const date = dateFormat(new Date(), 'longDate');

    getCommits(null, currentHash)
        .then(commits => {
            const historyString = commitsToMd(commits, {
                includeStrings: config.commitMessagesInclude,
                excludeStrings: config.commitMessagesExclude,
                url: config.commitBaseUrl,
                version: newVersion, date
            });
            shellEx(`echo "${historyString}\n\n$(cat ${file})" > ${file}`);
            resolve();
        });
});

const build = () => {
    if (config.buildCommand) {
        spinner.create('Building.');
        shellEx(config.buildCommand);
        spinner.succeed();
    }
};

const pushAll = () => {
    spinner.create('Pushing branches and tags');
    shellEx(`git push origin --all && git push origin --tags`, {silent: false});
    spinner.succeed();
};

const onEverythingPushed = () => {
    !flags.n && inquirer
        .prompt(prompts.npmPublish)
        .then(answer => {
            if (answer.npmPublish) {
                spinner.create('Publishing to npm');
                shellEx('npm publish', {silent: false});
                spinner.succeed();
            }
        });
};

const onGitFlowReleaseFinished = () => {
    inquirer.prompt(prompts.pushThemAll)
        .then(answer => {
            if (answer.pushThemAll) {
                pushAll();
                onEverythingPushed();
            }
        });
};

const finishRelease = () => {
    let tagMessage = `-m "Release"`;
    if (flags.m) {
        tagMessage = `-m "${flags.m}" `;
    }

    execSh(`git flow release finish ${tagMessage} ${newVersion}`)
        .then(onGitFlowReleaseFinished);
};

const onHistoryDone = commitCommand => {
    if (config.buildCommand) {
        build();
        commitCommand += ' updated build;';
    }
    shellEx(`${commitCommand}"`);
    finishRelease();
};

const onVersionsBumped = () => {
    const commitCommand = 'git commit -am "bumped version(s);';

    if (config.historyFile) {
        prependToHistoryFile(currentHash, newVersion, config.historyFile)
            .then(() => {
                onHistoryDone(`${commitCommand} updated History.md;`);
            });
    } else {
        onHistoryDone(commitCommand);
    }
};

const onReleaseTypeChosen = choice => {
    const releaseType = choice[Object.keys(choice)[0]];
    newVersion = semver.inc(currentVersion, releaseType);

    shellEx(`git flow release start ${newVersion}`);
    bumpVersions(config.versionFiles, newVersion)
        .then(onVersionsBumped);
};

const onReleaseTypeParam = () => {
    let releaseType = `${flags.t}`;
    newVersion = semver.inc(currentVersion, releaseType);

    shellEx(`git flow release start ${newVersion}`);
    bumpVersions(config.versionFiles, newVersion)
        .then(onVersionsBumped);
};


const onLastVersionResult = res => {
    currentVersion = res.version;
    currentHash = res.hash;
    if (flags.t) {
        onReleaseTypeParam();
    } else {
        inquirer.prompt(prompts.releaseTypes)
            .then(onReleaseTypeChosen);
    }
};

// Start
branchesUpToDate([config.productionBranchName, config.developBranchName]);

taggedVersions
    .getLastVersion()
    .then(onLastVersionResult)
    .catch(handleError);
