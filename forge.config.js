"use strict";

const path = require("node:path");
const pkg = require("./package.json");
const desktopTools = require("./tools/electron/package.json");

const ROOT = __dirname;
const ICON = path.join(ROOT, "build", "icons", "coink");
const DESKTOP_TOOLS = path.join(ROOT, "tools", "electron");
const ELECTRON_VERSION = desktopTools.devDependencies.electron;
const desktopModule = name => {
  try {
    return require.resolve(name, { paths:[DESKTOP_TOOLS] });
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      throw new Error(`Desktop build dependencies are missing. Run "npm run desktop:deps" before packaging. (${name})`);
    }
    throw error;
  }
};
const hasAppleNotarization = Boolean(
  process.env.MAC_CODESIGN_IDENTITY && process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID,
), hasWindowsCertificate = Boolean(process.env.WINDOWS_CERTIFICATE_FILE && process.env.WINDOWS_CERTIFICATE_PASSWORD),
  macEntitlements = path.join(ROOT, "build", "entitlements.mac.plist");
const macSigning = process.env.MAC_CODESIGN_IDENTITY ? {
  identity:process.env.MAC_CODESIGN_IDENTITY,
  optionsForFile:() => ({
    hardenedRuntime:true,
    entitlements:macEntitlements,
  }),
} : {
  // Sign the complete bundle even when Developer ID credentials are unavailable.
  // Electron's linker signature only covers its main executable and Gatekeeper
  // rejects the resulting quarantined app as damaged.
  identity:"-",
  identityValidation:false,
  optionsForFile:() => ({
    hardenedRuntime:false,
    entitlements:macEntitlements,
  }),
  preAutoEntitlements:false,
  preEmbedProvisioningProfile:false,
};

module.exports = {
  packagerConfig: {
    name:"CoInk",
    executableName:"CoInk",
    icon:ICON,
    asar:{ unpack:"**/node_modules/{sharp,@img}/**/*" },
    prune:true,
    appBundleId:"io.github.hridyanshuucsd.coink",
    appCategoryType:"public.app-category.productivity",
    appCopyright:`Copyright © ${new Date().getFullYear()} CoInk contributors`,
    extendInfo:{
      CFBundleDisplayName:"CoInk",
      CFBundleName:"CoInk",
      NSHumanReadableCopyright:`Copyright © ${new Date().getFullYear()} CoInk contributors`,
    },
    osxSign:macSigning,
    ...(hasAppleNotarization ? {
      osxNotarize:{
        tool:"notarytool",
        appleId:process.env.APPLE_ID,
        appleIdPassword:process.env.APPLE_APP_SPECIFIC_PASSWORD,
        teamId:process.env.APPLE_TEAM_ID,
      },
    } : {}),
    ...(hasWindowsCertificate ? {
      windowsSign:{
        signToolOptions:{
          certificateFile:process.env.WINDOWS_CERTIFICATE_FILE,
          certificatePassword:process.env.WINDOWS_CERTIFICATE_PASSWORD,
        },
      },
    } : {}),
    ignore:[
      /^\/\.git(?:\/|$)/,
      /^\/\.github(?:\/|$)/,
      /^\/tools(?:\/|$)/,
      /^\/out(?:\/|$)/,
      /^\/release(?:\/|$)/,
      /^\/coverage(?:\/|$)/,
      /^\/test-results(?:\/|$)/,
      /^\/playwright-report(?:\/|$)/,
      /^\/public\/plugins\/private(?:\/|$)/,
    ],
  },
  rebuildConfig:{ force:true },
  hooks:{
    readPackageJson:(_forgeConfig, packageJson) => ({
      ...packageJson,
      devDependencies:{ ...packageJson.devDependencies, electron:ELECTRON_VERSION },
    }),
  },
  makers:[
    {
      name:desktopModule("@electron-forge/maker-dmg"),
      platforms:["darwin"],
      config:{
        name:`CoInk-${pkg.version}`,
        title:"CoInk",
        icon:`${ICON}.icns`,
        overwrite:true,
      },
    },
    {
      name:desktopModule("@electron-forge/maker-zip"),
      platforms:["darwin"],
      config:{},
    },
    {
      name:desktopModule("@electron-forge/maker-squirrel"),
      platforms:["win32"],
      config:{
        name:"coink-tutor",
        authors:"CoInk contributors",
        description:pkg.description,
        exe:"CoInk.exe",
        setupExe:`CoInk-Setup-${pkg.version}-win-x64.exe`,
        setupIcon:`${ICON}.ico`,
        // Avoid invoking rcedit through Wine during cross-platform builds.
        // The installed app and Setup.exe still use the CoInk icon.
        skipUpdateIcon:true,
        iconUrl:`https://github.com/hridyanshuucsd/CoInk/releases/download/v${pkg.version}/coink.ico`,
        noMsi:true,
      },
    },
  ],
};
