// @ts-check
// GeneralNotability's rewrite of Tim's SPI helper script
// With contributions from 0xDeadbeef, DatGuy, Dreamy Jazz, L235, Tamzin, TheresNoTime, and Xiplus
// v2.9.1 "No sorcery threats"

/* global mw, $, importStylesheet, importScript, displayMessage, spiHelperCustomOpts */

// Adapted from [[User:Mr.Z-man/closeAFD]]
importStylesheet('User:GeneralNotability/spihelper-dev.css')
importScript('User:Timotheus Canens/displaymessage.js')

// Typedefs
/**
 * @typedef SelectOption
 * @type {Object}
 * @property {string} label Text to display in the drop-down
 * @property {string} value Value to return if this option is selected
 * @property {boolean} selected Whether this item should be selected by default
 * @property {boolean=} disabled Whether this item should be disabled
 */

/**
 * @typedef BlockEntry
 * @type {Object}
 * @property {string} username Username to block
 * @property {string} duration Duration of block
 * @property {boolean} acb If set, account creation is blocked
 * @property {boolean} ab Whether autoblock is enabled (for registered users)/
 *     logged-in users are blocked (for IPs)
 * @property {boolean} ntp If set, talk page access is blocked
 * @property {boolean} nem If set, email access is blocked
 * @property {string} tpn Type of talk page notice to apply on block
 */

/**
 * @typedef TagEntry
 * @type {Object}
 * @property {string} username Username to tag
 * @property {string} tag Tag to apply to user
 * @property {string} altmasterTag Altmaster tag to apply to user, if relevant
 * @property {boolean} blocking Whether this account is marked for block as well
 */

/**
  * @typedef ParsedArchiveNotice
  * @type {Object}
  * @property {string} username Case username
  * @property {boolean} xwiki Whether the crosswiki flag is set
  * @property {boolean} deny Whether the deny flag is set
  * @property {boolean} notalk Whether the notalk flag is set
  */

// Globals

/* User setting related globals */

// User-configurable settings, these are the defaults but will be updated by
// spiHelperLoadSettings()
const spiHelperSettings = {
  // Choices are 'watch' (unconditionally add to watchlist), 'preferences'
  // (follow default preferences), 'nochange' (don't change the watchlist
  // status of the page), and 'unwatch' (unconditionally remove)
  watchCase: 'preferences',
  watchCaseExpiry: 'indefinite',
  watchArchive: 'nochange',
  watchArchiveExpiry: 'indefinite',
  watchTaggedUser: 'preferences',
  watchTaggedUserExpiry: 'indefinite',
  watchNewCats: 'nochange',
  watchNewCatsExpiry: 'indefinite',
  watchBlockedUser: true,
  watchBlockedUserExpiry: 'indefinite',
  // Lets people disable clerk options if they're not a clerk
  clerk: true,
  // Log all actions to Special:MyPage/spihelper_log
  log: false,
  // Reverse said log, so that the newest actions are at the top.
  reversed_log: false,
  // Enable the "move section" button
  iUnderstandSectionMoves: false,
  // Automatically tick the "Archive case" option if the case is closed
  tickArchiveWhenCaseClosed: true,
  // Use checkuserblock-account when CU blocking. False when not a CU, by default true when a CU
  useCheckuserblockAccount: false,
  // Default IPv6 listings to /64 in the block/tag socks menu
  displayIPv6As64: true,
  // These are for debugging to view as other roles. If you're picking apart the code and
  // decide to set these (especially the CU option), it is YOUR responsibility to make sure
  // you don't do something that violates policy
  debugForceCheckuserState: null,
  debugForceAdminState: null
}

// Can't set in the spiHelperSettings declaration because spiHelperIsCheckuser itself uses the settings var
// This is initialized in main-orchestration.js after spiHelperIsCheckuser is defined
// spiHelperSettings.useCheckuserblockAccount = spiHelperIsCheckuser()

// Valid options for spiHelperSettings. Prevents invalid setting options being specified in the spioptions user subpage.
// This method only works options with discrete possible values. Settings without discrete possible values are checked for in spiHelperLoadSettings().
const spiHelperValidSettings = {
  watchCase: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchArchive: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchTaggedUser: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchNewCats: ['preferences', 'watch', 'nochange', 'unwatch'],
  watchBlockedUser: [true, false],
  clerk: [true, false],
  log: [true, false],
  reversed_log: [true, false],
  iUnderstandSectionMoves: [true, false],
  tickArchiveWhenCaseClosed: [true, false],
  useCheckuserblockAccount: [true, false],
  debugForceCheckuserState: [null, true, false],
  debugForceAdminState: [null, true, false]
}

// These user settings must be a valid date as defined by MediaWiki API. This is checked for in spiHelperValidateDate() via spiHelperLoadSettings()
const spiHelperSettingsNeedingValidDate = [
  'watchCaseExpiry',
  'watchArchiveExpiry',
  'watchTaggedUserExpiry',
  'watchNewCatsExpiry',
  'watchBlockedUserExpiry'
]

/* Globals to describe the current SPI page */

/** @type {string} Name of the SPI page in wiki title form
 * (e.g. Wikipedia:Sockpuppet investigations/Test) */
let spiHelperPageName = mw.config.get('wgPageName').replace(/_/g, ' ')

/** @type {number} The main page's ID - used to check if the page
 * has been edited since we opened it to prevent edit conflicts
 */
let spiHelperStartingRevID = mw.config.get('wgCurRevisionId')

const spiHelperIsThisPageAnArchive = mw.config.get('wgPageName').match('Wikipedia:Sockpuppet_investigations/.*/Archive.*')

/** @type {string} Just the username part of the case */
let spiHelperCaseName

if (spiHelperIsThisPageAnArchive) {
  spiHelperCaseName = spiHelperPageName.replace(/Wikipedia:Sockpuppet investigations\//g, '').replace(/\/Archive/, '')
} else {
  spiHelperCaseName = spiHelperPageName.replace(/Wikipedia:Sockpuppet investigations\//g, '')
}

/** list of section IDs + names corresponding to separate investigations */
let spiHelperCaseSections = []

/** @type {?number} Selected section, "null" means that we're opearting on the entire page */
let spiHelperSectionId = null

/** @type {?string} Selected section's name (e.g. "10 June 2020") */
let spiHelperSectionName = null

/** @type {ParsedArchiveNotice} */
let spiHelperArchiveNoticeParams

/** Map of top-level actions the user has selected */
const spiHelperActionsSelected = {
  Case_act: false,
  Block: false,
  Links: false,
  Note: false,
  Close: false,
  Rename: false,
  Archive: false,
  SpiMgmt: false
}

/** @type {BlockEntry[]} Requested blocks */
const spiHelperBlocks = []

/** @type {TagEntry[]} Requested tags */
const spiHelperTags = []

/** @type {string[]} Requested global locks */
const spiHelperGlobalLocks = []

// Count of unique users in the case (anything with a checkuser, checkip, user, ip, or vandal template on the page) for the block view
let spiHelperBlockTableUserCount = 0
// Count of unique users in the case (anything with a checkuser, checkip, user, ip, or vandal template on the page) for the link view (seperate needed as extra rows can be added)
let spiHelperLinkTableUserCount = 0

// The current wiki's interwiki prefix
const spiHelperInterwikiPrefix = spiHelperGetInterwikiPrefix()

// Map of active operations (used as a "dirty" flag for beforeunload)
// Values are strings representing the state - acceptable values are 'running', 'success', 'failed'
const spiHelperActiveOperations = new Map()

/* Globals to describe possible options for dropdown menus */

/** @type {SelectOption[]} List of possible selections for tagging a user in the block/tag interface
 */
const spiHelperTagOptions = [
  { label: 'None', selected: true, value: '' },
  { label: 'Suspected sock', value: 'blocked', selected: false },
  { label: 'Proven sock', value: 'proven', selected: false },
  { label: 'CU confirmed sock', value: 'confirmed', selected: false },
  { label: 'Blocked master', value: 'master', selected: false },
  { label: 'CU confirmed master', value: 'sockmasterchecked', selected: false },
  { label: '3X banned master', value: 'bannedmaster', selected: false }
]

/** @type {SelectOption[]} List of possible selections for tagging a user's altmaster in the block/tag interface */
const spiHelperAltMasterTagOptions = [
  { label: 'None', selected: true, value: '' },
  { label: 'Suspected alt master', value: 'suspected', selected: false },
  { label: 'Proven alt master', value: 'proven', selected: false }
]

/** @type {SelectOption[]} List of templates that CUs might insert */
const spiHelperCUTemplates = [
  { label: 'CU templates', selected: true, value: '', disabled: true },
  { label: 'Confirmed', selected: false, value: '{{confirmed}}' },
  { label: 'Confirmed/No Comment', selected: false, value: '{{confirmed-nc}}' },
  { label: 'Indistinguishable', selected: false, value: '{{tallyho}}' },
  { label: 'Likely', selected: false, value: '{{likely}}' },
  { label: 'Possilikely', selected: false, value: '{{possilikely}}' },
  { label: 'Possible', selected: false, value: '{{possible}}' },
  { label: 'Unlikely', selected: false, value: '{{unlikely}}' },
  { label: 'Unrelated', selected: false, value: '{{unrelated}}' },
  { label: 'Inconclusive', selected: false, value: '{{inconclusive}}' },
  { label: 'Need behavioral eval', selected: false, value: '{{behav}}' },
  { label: 'No sleepers', selected: false, value: '{{nosleepers}}' },
  { label: 'Stale', selected: false, value: '{{IPstale}}' },
  { label: 'No comment (IP)', selected: false, value: '{{ncip}}' }
]

/** @type {SelectOption[]} Templates that a clerk or admin might insert */
const spiHelperAdminTemplates = [
  { label: 'Admin/clerk templates', selected: true, value: '', disabled: true },
  { label: 'Duck', selected: false, value: '{{duck}}' },
  { label: 'Megaphone Duck', selected: false, value: '{{megaphone duck}}' },
  { label: 'IP blocked', selected: false, value: '{{IPblock}}' },
  { label: 'Blocked and tagged', selected: false, value: '{{bnt}}' },
  { label: 'Blocked, no tags', selected: false, value: '{{bwt}}' },
  { label: 'Blocked, awaiting tags', selected: false, value: '{{sblock}}' },
  { label: 'Blocked, tagged, closed', selected: false, value: '{{btc}}' },
  { label: 'Requested actions completed, closing', selected: false, value: '{{Action and close}}' },
  { label: 'Closing without action', selected: false, value: '{{Closing without action}}' },
  { label: 'Diffs needed', selected: false, value: '{{DiffsNeeded|moreinfo}}' },
  { label: 'Locks requested', selected: false, value: '{{GlobalLocksRequested}}' }
]

/* Globals for regexes */

// Regex to match the case status, group 1 is the actual status
const spiHelperCaseStatusRegex = /{{\s*SPI case status\s*\|?\s*(\S*?)\s*}}/i
// Regex to match closed case statuses (close or closed)
const spiHelperCaseClosedRegex = /^closed?$/i
// Regex to match the closed case statuses with the full template string (used for optimized one-click archiving)
const spiHelperCaseStatusClosedRegex = /{{\s*SPI case status\s*\|?\s*closed?\s*}}/i

const spiHelperClerkStatusRegex = /{{(CURequest|awaitingadmin|clerk ?request|(?:self|requestand|cu)?endorse|inprogress|decline(?:-ip)?|moreinfo|relisted|onhold)}}/i

const spiHelperSockSectionWithNewlineRegex = /====\s*Suspected sockpuppets\s*====\n*/i

const spiHelperAdminSectionWithPrecedingNewlinesRegex = /\n*\s*====\s*<big>Clerk, CheckUser, and\/or patrolling admin comments<\/big>\s*====\s*/i

const spiHelperCUBlockRegex = /{{(checkuserblock(-account|-wide)?|checkuser block)}}/i

const spiHelperArchiveNoticeRegex = /{{\s*SPI\s*archive notice\|(?:1=)?([^|]*?)(\|.*)?}}/i

const spiHelperPriorCasesRegex = /{{spipriorcases}}/i

const spiHelperSectionRegex = /^(?:===[^=]*===|=====[^=]*=====)\s*$/m

// regex to remove hidden characters from form inputs - they mess up some things,
// especially mw.util.isIP
const spiHelperHiddenCharNormRegex = /\u200E/g

/* Other globals */

/** @type{string} Advert to append to the edit summary of edits */
const spihelperAdvert = ' (using [[:w:en:WP:SPIH|spihelper.js]])'

/* Used by the link view */
const spiHelperLinkViewURLFormats = {
  editorInteractionAnalyser: { baseurl: 'https://sigma.toolforge.org/editorinteract.py', appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Editor Interaction Anaylser' },
  interactionTimeline: { baseurl: 'https://interaction-timeline.toolforge.org/', appendToQueryString: 'wiki=enwiki', userQueryStringKey: 'user', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Interaction Timeline' },
  timecardSPITools: { baseurl: 'https://spi-tools.toolforge.org/spi/timecard/' + spiHelperCaseName, appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Timecard comparisons' },
  consolidatedTimelineSPITools: { baseurl: 'https://spi-tools.toolforge.org/spi/timecard/' + spiHelperCaseName, appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'Consolidated Timeline (requires login)' },
  pagesSPITools: { baseurl: 'https://spi-tools.toolforge.org/spi/timeline/' + spiHelperCaseName, appendToQueryString: '', userQueryStringKey: 'users', userQueryStringSeparator: '&', userQueryStringWrapper: '', multipleUserQueryStringKeys: true, name: 'SPI Tools Pages (requires login)' },
  checkUserWikiSearch: { baseurl: 'https://checkuser.wikimedia.org/w/index.php', appendToQueryString: 'ns0=1', userQueryStringKey: 'search', userQueryStringSeparator: ' OR ', userQueryStringWrapper: '"', multipleUserQueryStringKeys: false, name: 'Checkuser wiki search' }
}

/* Actually put the portlets in place if needed */
// This is moved to main-orchestration.js after spiHelperAddLink is defined
// if (mw.config.get('wgPageName').includes('Wikipedia:Sockpuppet_investigations/') &&
//   !mw.config.get('wgPageName').includes('Wikipedia:Sockpuppet_investigations/SPI/')) {
//   mw.loader.load('mediawiki.user')
//   $(spiHelperAddLink)
// }

const spiHelperTopViewHTML = `
<div id="spiHelper_topViewDiv">
  <h3>Handling SPI case</h3>
  <select id="spiHelper_sectionSelect"></select>
  <h4 id="spiHelper_warning" class="spihelper-errortext" hidden></h4>
  <ul>
    <li id="spiHelper_actionLine"  class="spiHelper_singleCaseOnly spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Case_Action" id="spiHelper_Case_Action" />
      <label for="spiHelper_Case_Action">Change case status</label>
    </li>
    <li id="spiHelper_spiMgmtLine"  class="spiHelper_allCasesOnly spiHelper_notOnArchive">
      <input type="checkbox" id="spiHelper_SpiMgmt" />
      <label for="spiHelper_SpiMgmt">Change SPI options</label>
    </li>
    <li id="spiHelper_blockLine" class="spiHelper_adminClerkClass">
      <input type="checkbox" name="spiHelper_BlockTag" id="spiHelper_BlockTag" />
      <label for="spiHelper_BlockTag">Block/tag socks</label>
    </li>
    <li id="spiHelper_userInfoLine" class="spiHelper_singleCaseOnly">
      <input type="checkbox" name="spiHelper_userInfo" id="spiHelper_userInfo" />
      <label for="spiHelper_userInfo">Sock links</label>
    </li>
    <li id="spiHelper_commentLine" class="spiHelper_singleCaseOnly spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Comment" id="spiHelper_Comment" />
      <label for="spiHelper_Comment">Note/comment</label>
    </li>
    <li id="spiHelper_closeLine" class="spiHelper_adminClerkClass spiHelper_singleCaseOnly spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Close" id="spiHelper_Close" />
      <label for="spiHelper_Close">Close case</label>
    </li>
    <li id="spiHelper_moveLine" class="spiHelper_clerkClass spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Move" id="spiHelper_Move" />
      <label for="spiHelper_Move" id="spiHelper_moveLabel">Move/merge full case (Clerk only)</label>
    </li>
    <li id="spiHelper_archiveLine" class="spiHelper_clerkClass spiHelper_notOnArchive">
      <input type="checkbox" name="spiHelper_Archive" id="spiHelper_Archive"/>
      <label for="spiHelper_Archive">Archive case (Clerk only)</label>
    </li>
  </ul>
  <input type="button" id="spiHelper_GenerateForm" name="spiHelper_GenerateForm" value="Continue" />
</div>
`

const spiHelperActionViewHTML = `
<div id="spiHelper_actionViewDiv">
  <small><a id="spiHelper_backLink">Back to top menu</a></small>
  <br>
  <h3>Handling SPI case</h3>
  <div id="spiHelper_actionView">
    <h4>Changing case status</h4>
    <label for="spiHelper_CaseAction">New status:</label>
    <select id="spiHelper_CaseAction"></select>
  </div>
  <div id="spiHelper_spiMgmtView">
    <h4>Changing SPI settings</h4>
    <ul>
      <li>
        <input type="checkbox" id="spiHelper_spiMgmt_crosswiki" />
        <label for="spiHelper_spiMgmt_crosswiki">Case is crosswiki</label>
      </li>
      <li>
        <input type="checkbox" id="spiHelper_spiMgmt_deny" />
        <label for="spiHelper_spiMgmt_deny">Socks should not be tagged per DENY</label>
      </li>
      <li>
        <input type="checkbox" id="spiHelper_spiMgmt_notalk" />
        <label for="spiHelper_spiMgmt_notalk">Socks should have talk page and email access revoked due to past abuse</label>
      </li>
    </ul>
  </div>
  <div id="spiHelper_sockLinksView">
    <h4 id="spiHelper_sockLinksHeader">Useful links for socks</h4>
    <table id="spiHelper_userInfoTable" style="border-collapse:collapse;">
      <tr>
        <th>Username</th>
        <th><span title="Editor interaction analyser" class="rt-commentedText spihelper-hovertext">Interaction analyser</span></th>
        <th><span title="Interaction timeline" class="rt-commentedText spihelper-hovertext">Interaction timeline</span></th>
        <th><span title="Timecard comparison - SPI tools" class="rt-commentedText spihelper-hovertext">Timecard</span></th>
        <th class="spiHelper_adminClass"><span title="Consolidated timeline (login needed) - SPI tools" class="rt-commentedText spihelper-hovertext">Consolidated timeline</span></th>
        <th class="spiHelper_adminClass"><span title="Pages - SPI tools (login needed)" class="rt-commentedText spihelper-hovertext">Pages</span></th>
        <th class="spiHelper_cuClass"><span title="CheckUser wiki search" class="rt-commentedText spihelper-hovertext">CU wiki</span></th>
      </tr>
      <tr style="border-bottom:2px solid black">
        <td style="text-align:center;">(All users)</td>
        <td style="text-align:center;"><input type="checkbox" id="spiHelper_link_editorInteractionAnalyser"/></td>
        <td style="text-align:center;"><input type="checkbox" id="spiHelper_link_interactionTimeline"/></td>
        <td style="text-align:center;"><input type="checkbox" id="spiHelper_link_timecardSPITools"/></td>
        <td style="text-align:center;" class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_link_consolidatedTimelineSPITools"/></td>
        <td style="text-align:center;" class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_link_pagesSPITools"/></td>
        <td style="text-align:center;" class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_link_checkUserWikiSearch"/></td>
      </tr>
    </table>
    <span><input type="button" id="moreSerks" value="Add Row" onclick="spiHelperAddBlankUserLine('block');"/></span>
  </div>
  <div id="spiHelper_blockTagView">
    <h4 id="spiHelper_blockTagHeader">Blocking and tagging socks</h4>
    <ul>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_noblock" id="spiHelper_noblock" />
        <label for="spiHelper_noblock">Do not make any blocks (this overrides the individual "Blk" boxes below).</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_override" id="spiHelper_override" />
        <label for="spiHelper_override">Override any existing blocks.</label>
      </li>
      <li class="spiHelper_clerkClass">
        <input type="checkbox" checked="checked" name="spiHelper_tagAccountsWithoutLocalAccount" id="spiHelper_tagAccountsWithoutLocalAccount" />
        <label for="spiHelper_tagAccountsWithoutLocalAccount">Tag accounts without an attached local account.</label>
      </li>
      <li class="spiHelper_cuClass">
        <input type="checkbox" name="spiHelper_cublock" id="spiHelper_cublock" />
        <label for="spiHelper_cublock">Mark blocks as Checkuser blocks.</label>
      </li>
      <li class="spiHelper_cuClass">
        <input type="checkbox" name="spiHelper_cublockonly" id="spiHelper_cublockonly" />
        <label for="spiHelper_cublockonly">
          Suppress the usual block summary and only use {{checkuserblock-account}} and {{checkuserblock}} (no effect if "mark blocks as CU blocks" is not checked).
        </label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" checked="checked" name="spiHelper_blocknoticemaster" id="spiHelper_blocknoticemaster" />
        <label for="spiHelper_blocknoticemaster">Add talk page notice when (re)blocking the sockmaster.</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" checked="checked" name="spiHelper_blocknoticesocks" id="spiHelper_blocknoticesocks" />
        <label for="spiHelper_blocknoticesocks">Add talk page notice when blocking socks.</label>
      </li>
      <li class="spiHelper_adminClass">
        <input type="checkbox" name="spiHelper_blanktalk" id="spiHelper_blanktalk" />
        <label for="spiHelper_blanktalk">Blank the talk page when adding talk notices.</label>
      </li>
      <li>
        <input type="checkbox" name="spiHelper_hidelocknames" id="spiHelper_hidelocknames" />
        <label for="spiHelper_hidelocknames">Hide usernames when requesting global locks.</label>
      </li>
    </ul>
    <table id="spiHelper_blockTable" style="border-collapse:collapse;">
      <tr>
        <th>Username</th>
        <th class="spiHelper_adminClass"><span title="Block user" class="rt-commentedText spihelper-hovertext">Blk?</span></th>
        <th class="spiHelper_adminClass"><span title="Block duration" class="rt-commentedText spihelper-hovertext">Duration</span></th>
        <th class="spiHelper_adminClass"><span title="Account creation blocked" class="rt-commentedText spihelper-hovertext">ACB</span></th>
        <th class="spiHelper_adminClass"><span title="Autoblock (for logged-in users)/Anonymous-only (for IPs)" class="rt-commentedText spihelper-hovertext">AB/AO</span></th>
        <th class="spiHelper_adminClass"><span title="Disable talk page access" class="rt-commentedText spihelper-hovertext">NTP</span></th>
        <th class="spiHelper_adminClass"><span title="Disable email" class="rt-commentedText spihelper-hovertext">NEM</span></th>
        <th>Tag</th>
        <th><span title="Tag the user with a suspected alternate master" class="rt-commentedText spihelper-hovertext">Alt Master</span></th>
        <th><span title="Request a global lock at Meta:SRG" class="rt-commentedText spihelper-hovertext">Req Lock?</span></th>
      </tr>
      <tr style="border-bottom:2px solid black">
        <td style="text-align:center;">(All users)</td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_doblock"/></td>
        <td class="spiHelper_adminClass"></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_acb" checked="checked"/></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_ab" checked="checked"/></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_tp"/></td>
        <td class="spiHelper_adminClass"><input type="checkbox" id="spiHelper_block_email"/></td>
        <td><select id="spiHelper_block_tag"></select></td>
        <td><select id="spiHelper_block_tag_altmaster"></select></td>
  
        <td><input type="checkbox" name="spiHelper_block_lock_all" id="spiHelper_block_lock"/></td>
      </tr>
    </table>
    <span><input type="button" id="moreSerks" value="Add Row" onclick="spiHelperAddBlankUserLine('block');"/></span>
  </div>
  <div id="spiHelper_closeView">
    <h4>Marking case as closed</h4>
    <input type="checkbox" checked="checked" id="spiHelper_CloseCase" />
    <label for="spiHelper_CloseCase">Close this SPI case</label>
  </div>
  <div id="spiHelper_moveView">
    <h4 id="spiHelper_moveHeader">Move section</h4>
    <label for="spiHelper_moveTarget">New sockmaster username: </label>
    <input type="text" name="spiHelper_moveTarget" id="spiHelper_moveTarget" />
  </div>
  <div id="spiHelper_archiveView">
    <h4>Archiving case</h4>
    <input type="checkbox" checked="checked" name="spiHelper_ArchiveCase" id="spiHelper_ArchiveCase" />
    <label for="spiHelper_ArchiveCase">Archive this SPI case</label>
  </div>
  <div id="spiHelper_commentView">
    <h4>Comments</h4>
    <span>
      <select id="spiHelper_noteSelect"></select>
      <select class="spiHelper_adminClerkClass" id="spiHelper_adminSelect"></select>
      <select class="spiHelper_cuClass" id="spiHelper_cuSelect"></select>
    </span>
    <div>
      <label for="spiHelper_CommentText">Comment:</label>
      <textarea rows="3" cols="80" id="spiHelper_CommentText">*</textarea>
      <div><a id="spiHelper_previewLink">Preview</a></div>
    </div>
    <div class="spihelper-previewbox" id="spiHelper_previewBox" hidden></div>
  </div>
  <br>
  <input type="button" id="spiHelper_performActions" value="Done" />
</div>
`
