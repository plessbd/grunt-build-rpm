/*
 * grunt-build-rpm
 * https://github.com/plessbd/grunt-build-rpm
 *
 * Copyright (c) 2014 Ben Plessinger
 * Licensed under the MIT license.
 */

'use strict';

var shortid = require("shortid"),
	path = require("path"),
	async = require("async");

function writeSpecFile(grunt, files, attrBasket, options) {

	var pkgName = options.name + "-" + options.version + "-" + options.buildArch,
		specFilepath = path.join(options.tempDir, "SPECS", pkgName + ".spec"),
		specFileContent = "",
		b = [],
		i = 0,
		defattr;

	b.push("%define	 _topdir " + path.resolve(options.tempDir));
	b.push("");
	b.push("Name: " + options.name);
	b.push("Version: " + options.version);
	b.push("Group: " + options.group);
	b.push("Release: " + options.release);
	b.push("Summary: " + options.summary);
	b.push("License: " + options.license);
	b.push("BuildArch: " + options.buildArch);

	if (options.dependencies.length > 0) {
		b.push("Requires: " + options.dependencies.join(","));
	}

	b.push("");
	b.push("%description");
	b.push(options.description);
	b.push("");
	b.push("%files");
	for (i = 0; i < options.defattrScript.length; i++) {
		defattr = options.defattrScript[i];
		b.push("%defattr(" +
			(defattr.fileMode || '-') + ', ' +
			(defattr.user || '-') + ', ' +
			(defattr.group || '-') + ', ' +
			(defattr.dirMode || '-') + ')');
	}
	for (i = 0; i < files.length; i++) {
			b.push(files[i]);
	}
	b.push("");
	b.push("%pre");
	for (i = 0; i < options.preInstallScript.length; i++) {
		b.push(options.preInstallScript[i]);
	}
	b.push("");
	b.push("%post");
	// Push the file attribute changes.
	for (i = 0; i < attrBasket.length; i++) {
		b.push(attrBasket[i]);
	}
	// Push the post install scripts after the file attribute changes.
	for (i = 0; i < options.postInstallScript.length; i++) {
		b.push(options.postInstallScript[i]);
	}
	b.push("");
	b.push("%preun");
	for (i = 0; i < options.preUninstallScript.length; i++) {
		b.push(options.preUninstallScript[i]);
	}
	b.push("");
	b.push("%postun");
	for (i = 0; i < options.postUninstallScript.length; i++) {
		b.push(options.postUninstallScript[i]);
	}

	specFileContent = b.join("\n");
	grunt.file.write(specFilepath, specFileContent);

	return specFilepath;
}


module.exports = function(grunt) {

	grunt.registerMultiTask("grunt-build-rpm", "Create RPM package to install files/directories", function() {

		var that = this,
			tmpDirPrefix = "grunt-build-rpm-tmp-",
			options = this.options({
				name: "noname",
				summary: "No Summary",
				description: "No Description",
				version: "0.1.0",
				release: "1",
				license: "MIT",
				vendor: "Vendor",
				group: "Development/Tools",
				buildArch: "noarch",
				dependencies: [],
				preInstallScript: [],
				postInstallScript: [],
				preUninstallScript: [],
				postUninstallScript: [],
				defattrScript: [],
				tempDir: tmpDirPrefix + shortid.generate(),
				postPackageCreate: null,
				keepTemp: true,
				requires: ""}),
			done = this.async(),
			tmpDir = path.resolve(options.tempDir),
			buildRoot = tmpDir + "/BUILDROOT/",
			rpmStructure = ["BUILD","BUILDROOT","RPMS","SOURCES","SPECS","SRPMS"],
			fileBasket = [],
			attrBasket = [],
			filesToExclude = [],
			i = 0,
			specFilepath, rpmFilename, rpmPath;

		//If the tmpDir exists (probably from previous build), delete it first
		if (grunt.file.exists(tmpDir)) {
			grunt.log.writeln("Deleting old tmp dir");
			grunt.file.delete(tmpDir);
		}

		//Create RPM build folder structure
		grunt.log.writeln("Creating RPM folder structure at " + tmpDir);
		for (i = rpmStructure.length-1; i>=0; i--) {
			grunt.verbose.writeln("Creating: " + tmpDir + "/" + rpmStructure[i]);
			grunt.file.mkdir(tmpDir + "/" + rpmStructure[i]);
		}

		//Files to exclude
		if (this.data.excludeFiles) {
			filesToExclude = grunt.file.expand(this.data.excludeFiles).map(function (fileName) {
				return path.normalize(fileName);
			});
		}

		//Copy source to the BUILDROOT folder
		grunt.log.writeln("Copying files to tmp directory");

		this.files.forEach(function(file) {

			//All file entry should have both "src" and "dest"
			if (!file.src || !file.dest) {
				grunt.log.error("All file entries must have both 'src' and 'dest' property");
				done(false);
			}

			file.src.filter(function(srcPath) {
				var actualSrcPath = srcPath,
					copyTargetPath, actualTargetPath;
				//check whether to ignore this file
				if (filesToExclude.indexOf(actualSrcPath) >= 0) {
					return false;
				}
				//If the CWD option is specified, look for each file from CWD path
				if (file.cwd) {
					actualSrcPath = path.join(file.cwd, srcPath);
				}

				//Copy file to the BUILDROOT directory and store the actual target path
				//for generating the SPEC file

				if (!grunt.file.isDir(actualSrcPath) && actualSrcPath.search(tmpDirPrefix) === -1) {
					grunt.verbose.writeln("Copying: " + actualSrcPath);
					copyTargetPath = path.join(buildRoot, file.dest, srcPath);
					grunt.file.copy(actualSrcPath, copyTargetPath);

					//Generate actualTargetPath and save to filebasket for later use
					actualTargetPath = "\"" + path.join(file.dest, srcPath) + "\"";
					if (file.config) {
						 fileBasket.push("%config " + actualTargetPath);
					 }
					 else if (file.doc) {
						 fileBasket.push("%doc " + actualTargetPath);
					 }
					 else {
						 fileBasket.push(actualTargetPath);
					 }

					//If "mode" property is defined, then add the post install script to change
					//the mode of the file
					if (file.mode) {
						attrBasket.push("chmod " + file.mode + " " + actualTargetPath);
					}

					//If "owner" property is defined, then add the post install script to change
					//the owner of the file
					if (file.owner) {
						attrBasket.push("chown " + file.owner + " " + actualTargetPath);
					}

					//If "group" property is defined, then add the post install script to change
					//the group of the file
					if (file.group) {
						attrBasket.push("chgrp " + file.group + " " + actualTargetPath);
					}
				}
			});
		});

		//Generate SPEC file
		grunt.log.writeln("Generating RPM spec file");
		specFilepath = writeSpecFile(grunt, fileBasket, attrBasket, options);

		//Build RPM
		grunt.log.writeln("Building RPM package");
		async.series([

			//spawn rpmbuild tool
			function(callback) {
				var buildCmd = "rpmbuild",
					buildArgs = [
						"-bb",
						"--buildroot",
						buildRoot,
						specFilepath
					];
				grunt.log.writeln("Execute: " + buildCmd + " " + buildArgs.join(" "));
				grunt.util.spawn({
						cmd: buildCmd,
						args: buildArgs
					},
					function (err, info) {
						grunt.log.writeln("Done: " + info);
						callback.apply(that, arguments);
					});
			},
			function(callback) {
				if (options.postPackageCreate){
					rpmFilename = options.name + "-" + options.version + "-" + options.release + "." + options.buildArch + ".rpm";
					rpmPath = path.join(tmpDir, "RPMS", options.buildArch);
					var destinationFile;

					if (typeof options.postPackageCreate === "string"){
						if (grunt.file.isDir(options.postPackageCreate)){
							destinationFile = path.join(options.postPackageCreate, rpmFilename);
							grunt.file.copy(path.join(rpmPath, rpmFilename) , destinationFile);
							grunt.log.writeln("Copied output RPM package to: " + destinationFile);
						}
						else {
							grunt.fail.warn('Destination path is not a directory');
						}
					}
				}
				callback();
			},
			function(callback){

				if (typeof options.postPackageCreate === "function"){
					grunt.log.writeln("Calling postPackageCreate function");
					options.postPackageCreate(rpmPath, rpmFilename, callback);
				}
				else{
					callback();
				}
			},
			function(callback){
				//Delete temp folder
				if (!options.keepTemp) {
					grunt.log.writeln("Deleting tmp folder " + tmpDir);
					grunt.file.delete(tmpDir);
				}
				callback();
			}
		],
			function (err) {
				if (!err) {
					done();
				} else {
					grunt.log.error(err);
					done(false);
				}
			});
	});
};
