// API and utility functions for spihelper
// This module contains all MediaWiki API wrappers and utility functions

function spiHelperGetAPI (title) {
  'use strict'
  if (title.startsWith('m:') || title.startsWith('meta:')) {
    return new mw.ForeignApi('https://meta.wikimedia.org/w/api.php')
  } else {
    return new mw.Api()
  }
}

/**
 * Removes the interwiki prefix from a page title
 *
 * @param {*} title Page name including interwiki prefix
 * @return {string} Just the page name
 */
function spiHelperStripXWikiPrefix (title) {
  // TODO: This only works with single-colon names, make it more robust
  'use strict'
  if (title.startsWith('m:') || title.startsWith('meta:')) {
    return title.slice(title.indexOf(':') + 1)
  } else {
    return title
  }
}

/**
 * Get the post-expand include size of a given page
 *
 * @param {string} title Page title to check
 * @param {?number} sectionId Section to check, if null check the whole page
 *
 * @return {Promise<number>} Post-expand include size of the given page/page section
 */
async function spiHelperGetPostExpandSize (title, sectionId = null) {
  // Synchronous method to get a page's post-expand include size given its title
  const finalTitle = spiHelperStripXWikiPrefix(title)

  const request = {
    action: 'parse',
    prop: 'limitreportdata',
    page: finalTitle
  }
  if (sectionId) {
    request.section = sectionId
  }
  const api = spiHelperGetAPI(title)
  try {
    const response = await api.get(request)

    // The page might not exist, so we need to handle that smartly - only get the parse
    // if the page actually parsed
    if ('parse' in response) {
      // Iterate over all properties to find the PEIS
      for (let i = 0; i < response.parse.limitreportdata.length; i++) {
        if (response.parse.limitreportdata[i].name === 'limitreport-postexpandincludesize') {
          return response.parse.limitreportdata[i][0]
        }
      }
    }
  } catch (error) {
    // Something's gone wrong, just return 0
  }

  return 0
}

/**
 * Get the maximum post-expand size from the wgPageParseReport (it's the same for all pages)
 *
 * @return {number} The max post-expand size in bytes
 */
function spiHelperGetMaxPostExpandSize () {
  'use strict'
  return mw.config.get('wgPageParseReport').limitreport.postexpandincludesize.limit
}

/**
 * Get the inter-wiki prefix for the current wiki
 *
 * @return {string} The inter-wiki prefix
 */
function spiHelperGetInterwikiPrefix () {
  // Mostly copied from https://github.com/Xi-Plus/twinkle-global/blob/master/morebits.js
  // Most of this should be overkill (since most of these wikis don't have checkuser support)
  /** @type {string[]} */ const temp = mw.config.get('wgServer').replace(/^(https?:)?\/\//, '').split('.')
  const wikiLang = temp[0]
  const wikiFamily = temp[1]
  switch (wikiFamily) {
    case 'wikimedia':
      switch (wikiLang) {
        case 'commons':
          return ':commons:'
        case 'meta':
          return ':meta:'
        case 'species:':
          return ':species:'
        case 'incubator':
          return ':incubator:'
        default:
          return ''
      }
    case 'mediawiki':
      return 'mw'
    case 'wikidata:':
      switch (wikiLang) {
        case 'test':
          return ':testwikidata:'
        case 'www':
          return ':d:'
        default:
          return ''
      }
    case 'wikipedia':
      switch (wikiLang) {
        case 'test':
          return ':testwiki:'
        case 'test2':
          return ':test2wiki:'
        default:
          return ':w:' + wikiLang + ':'
      }
    case 'wiktionary':
      return ':wikt:' + wikiLang + ':'
    case 'wikiquote':
      return ':q:' + wikiLang + ':'
    case 'wikibooks':
      return ':b:' + wikiLang + ':'
    case 'wikinews':
      return ':n:' + wikiLang + ':'
    case 'wikisource':
      return ':s:' + wikiLang + ':'
    case 'wikiversity':
      return ':v:' + wikiLang + ':'
    case 'wikivoyage':
      return ':voy:' + wikiLang + ':'
    default:
      return ''
  }
}

// "Building-block" functions to wrap basic API calls
/**
 * Get the text of a page. Not that complicated.
 *
 * @param {string} title Title of the page to get the contents of
 * @param {boolean} show Whether to show page fetch progress on-screen
 * @param {?number} [sectionId=null] Section to retrieve, setting this to null will retrieve the entire page
 *
 * @return {Promise<string>} The text of the page, '' if the page does not exist.
 */
async function spiHelperGetPageText (title, show, sectionId = null) {
  const $statusLine = $('<li>')
  if (show) {
    // Actually display the statusLine
    $('#spiHelper_status', document).append($statusLine)
  }
  // Build the link element (use JQuery so we get escapes and such)
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html('Getting page ' + $link.prop('outerHTML'))

  const finalTitle = spiHelperStripXWikiPrefix(title)

  const request = {
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    indexpageids: true,
    titles: finalTitle
  }

  if (sectionId) {
    request.rvsection = sectionId
  }

  try {
    const response = await spiHelperGetAPI(title).get(request)
    const pageid = response.query.pageids[0]

    if (pageid === '-1') {
      $statusLine.html('Page ' + $link.html() + ' does not exist')
      return ''
    }
    $statusLine.html('Got ' + $link.html())
    return response.query.pages[pageid].revisions[0].slots.main['*']
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to get ' + $link.html() + '</b>: ' + error)
    return ''
  }
}

/**
 *
 * @param {string} title Title of the page to edit
 * @param {string} newtext New content of the page
 * @param {string} summary Edit summary to use for the edit
 * @param {boolean} createonly Only try to create the page - if false,
 *                             will fail if the page already exists
 * @param {string} watch What watchlist setting to use when editing - decides
 *                       whether the edited page will be watched
 * @param {string} watchExpiry Duration to watch the edited page, if unset
 *                             defaults to 'indefinite'
 * @param {?number} baseRevId Base revision ID, used to detect edit conflicts. If null,
 *                           we'll grab the current page ID.
 * @param {?number} [sectionId=null] Section to edit - if null, edits the whole page
 *
 * @return {Promise<boolean>} Whether the edit was successful
 */
async function spiHelperEditPage (title, newtext, summary, createonly, watch, watchExpiry = null, baseRevId = null, sectionId = null) {
  let activeOpKey = 'edit_' + title
  if (sectionId) {
    activeOpKey += '_' + sectionId
  }
  spiHelperActiveOperations.set(activeOpKey, 'running')
  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)

  $statusLine.html('Editing ' + $link.prop('outerHTML'))

  const api = spiHelperGetAPI(title)
  const finalTitle = spiHelperStripXWikiPrefix(title)

  const request = {
    action: 'edit',
    watchlist: watch,
    summary: summary + spihelperAdvert,
    text: newtext,
    title: finalTitle,
    createonly: createonly
  }
  if (sectionId) {
    request.section = sectionId
  }
  if (watchExpiry) {
    request.watchlistexpiry = watchExpiry
  }
  if (baseRevId) {
    request.baserevid = baseRevId
  }
  try {
    await api.postWithToken('csrf', request)
    $statusLine.html('Saved ' + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
    return true
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Edit failed on ' + $link.html() + '</b>: ' + error)
    console.error(error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
    return false
  }
}
/**
 * Moves a page. Exactly what it sounds like.
 *
 * @param {string} sourcePage Title of the source page (page we're moving)
 * @param {string} destPage Title of the destination page (page we're moving to)
 * @param {string} summary Edit summary to use for the move
 * @param {boolean} ignoreWarnings Whether to ignore warnings on move (used to force-move one page over another)
 */
async function spiHelperMovePage (sourcePage, destPage, summary, ignoreWarnings, moveSubpages = true) {
  const activeOpKey = 'move_' + sourcePage + '_' + destPage
  spiHelperActiveOperations.set(activeOpKey, 'running')

  // Should never be a crosswiki call
  const api = new mw.Api()

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $sourceLink = $('<a>').attr('href', mw.util.getUrl(sourcePage)).attr('title', sourcePage).text(sourcePage)
  const $destLink = $('<a>').attr('href', mw.util.getUrl(destPage)).attr('title', destPage).text(destPage)

  $statusLine.html('Moving ' + $sourceLink.prop('outerHTML') + ' to ' + $destLink.prop('outerHTML'))

  try {
    await api.postWithToken('csrf', {
      action: 'move',
      from: sourcePage,
      to: destPage,
      reason: summary + spihelperAdvert,
      noredirect: false,
      movesubpages: moveSubpages,
      ignoreWarnings: ignoreWarnings
    })
    $statusLine.html('Moved ' + $sourceLink.prop('outerHTML') + ' to ' + $destLink.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to move ' + $sourceLink.prop('outerHTML') + ' to ' + $destLink.prop('outerHTML') + '</b>: ' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

/**
 * Purges a page's cache
 *
 *
 * @param {string} title Title of the page to purge
 */
async function spiHelperPurgePage (title) {
  // Forces a cache purge on the selected page
  'use strict'
  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html('Purging ' + $link.prop('outerHTML'))
  const strippedTitle = spiHelperStripXWikiPrefix(title)

  const api = spiHelperGetAPI(title)
  try {
    await api.postWithToken('csrf', {
      action: 'purge',
      titles: strippedTitle
    })
    $statusLine.html('Purged ' + $link.prop('outerHTML'))
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to purge ' + $link.prop('outerHTML') + '</b>: ' + error)
  }
}

/**
 * Blocks a user.
 *
 * @param {string} user Username to block
 * @param {string} duration Duration of the block
 * @param {string} reason Reason to log for the block
 * @param {boolean} reblock Whether to reblock - if false, nothing will happen if the target user is already blocked
 * @param {boolean} anononly For IPs, whether this is an anonymous-only block (alternative is
 *                           that logged-in users with the IP are also blocked)
 * @param {boolean} accountcreation Whether to permit the user to create new accounts
 * @param {boolean} autoblock Whether to apply an autoblock to the user's IP
 * @param {boolean} talkpage Whether to revoke talkpage access
 * @param {boolean} email Whether to block email
 * @param {boolean} watchBlockedUser Watchlist setting for whether to watch the newly-blocked user
 * @param {string} watchExpiry Duration to watch the blocked user, if unset
 *                             defaults to 'indefinite'

 * @return {Promise<boolean>} True if the block suceeded, false if not
 */
async function spiHelperWikiBlockUser (user, duration, reason, reblock, anononly, accountcreation,
  autoblock, talkpage, email, watchBlockedUser, watchExpiry) {
  'use strict'
  const activeOpKey = 'block_' + user
  spiHelperActiveOperations.set(activeOpKey, 'running')

  if (!watchExpiry) {
    watchExpiry = 'indefinite'
  }
  const userPage = 'User:' + user
  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(userPage)).attr('title', userPage).text(user)
  $statusLine.html('Blocking ' + $link.prop('outerHTML'))

  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    await api.postWithToken('csrf', {
      action: 'block',
      expiry: duration,
      reason: reason,
      reblock: reblock,
      anononly: anononly,
      nocreate: accountcreation,
      autoblock: autoblock,
      allowusertalk: !talkpage,
      noemail: email,
      watchuser: watchBlockedUser,
      watchlistexpiry: watchExpiry,
      user: user
    })
    $statusLine.html('Blocked ' + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
    return true
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to block ' + $link.prop('outerHTML') + '</b>: ' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
    return false
  }
}

/**
 * Get whether a user is currently blocked
 *
 * @param {string} user Username
 * @return {Promise<string>} Block reason, empty string if not blocked
 */
async function spiHelperGetUserBlockReason (user) {
  'use strict'
  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'blocks',
      bklimit: '1',
      bkusers: user,
      bkprop: 'user|reason'
    })
    if (response.query.blocks.length === 0) {
      // If the length is 0, then the user isn't blocked
      return ''
    }
    return response.query.blocks[0].reason
  } catch (error) {
    return ''
  }
}

/**
 * Get a user's current block settings
 *
 * @param {string} user Username
 * @return {Promise<BlockEntry>} Current block settings for the user, or null if the user is not blocked
*/
async function spiHelperGetUserBlockSettings (user) {
  'use strict'
  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'blocks',
      bklimit: '1',
      bkusers: user,
      bkprop: 'user|reason|flags|expiry'
    })
    if (response.query.blocks.length === 0) {
      // If the length is 0, then the user isn't blocked
      return null
    }

    /** @type {BlockEntry} */
    const item = {
      username: user,
      duration: response.query.blocks[0].expiry,
      acb: ('nocreate' in response.query.blocks[0] || 'anononly' in response.query.blocks[0]),
      ab: 'autoblock' in response.query.blocks[0],
      ntp: !('allowusertalk' in response.query.blocks[0]),
      nem: 'noemail' in response.query.blocks[0],
      tpn: ''
    }
    return item
  } catch (error) {
    return null
  }
}

/**
 * Get whether a user is currently globally locked
 *
 * @param {string} user Username
 * @return {Promise<boolean>} Whether the user is globally locked
 */
async function spiHelperIsUserGloballyLocked (user) {
  'use strict'
  // This is not something which should ever be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'globalallusers',
      agulimit: '1',
      agufrom: user,
      aguto: user,
      aguprop: 'lockinfo'
    })
    if (response.query.globalallusers.length === 0) {
      // If the length is 0, then we couldn't find the global user
      return false
    }
    // If the 'locked' field is present, then the user is locked
    return 'locked' in response.query.globalallusers[0]
  } catch (error) {
    return false
  }
}

async function spiHelperDoesUserExistLocally (user) {
  'use strict'
  // This should never be cross-wiki
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'allusers',
      aulimit: '1',
      aufrom: user,
      auto: user
    })
    if (response.query.allusers.length === 0) {
      // If the length is 0, then we couldn't find the local account so return false
      return false
    }
    // Otherwise a local account exists so return true
    return true
  } catch (error) {
    return false
  }
}

async function spiHelperDoesUserExistGlobally (user) {
  'use strict'
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      list: 'globalallusers',
      agulimit: '1',
      agufrom: user,
      aguto: user
    })
    if (response.query.globalallusers.length === 0) {
      // If the length is 0, then we couldn't find the global user so return false
      return false
    }
    // Otherwise the global account exists so return true
    return true
  } catch (error) {
    return false
  }
}

/**
 * Get a page's latest revision ID - useful for preventing edit conflicts
 *
 * @param {string} title Title of the page
 * @return {Promise<number>} Latest revision of a page, 0 if it doesn't exist
 */
async function spiHelperGetPageRev (title) {
  'use strict'

  const finalTitle = spiHelperStripXWikiPrefix(title)
  const request = {
    action: 'query',
    prop: 'revisions',
    rvslots: 'main',
    indexpageids: true,
    titles: finalTitle
  }

  try {
    const response = await spiHelperGetAPI(title).get(request)
    const pageid = response.query.pageids[0]
    if (pageid === '-1') {
      return 0
    }
    return response.query.pages[pageid].revisions[0].revid
  } catch (error) {
    return 0
  }
}

/**
 * Delete a page. Admin-only function.
 *
 * @param {string} title Title of the page to delete
 * @param {string} reason Reason to log for the page deletion
 */
async function spiHelperDeletePage (title, reason) {
  'use strict'

  const activeOpKey = 'delete_' + title
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html('Deleting ' + $link.prop('outerHTML'))

  const api = spiHelperGetAPI(title)
  try {
    await api.postWithToken('csrf', {
      action: 'delete',
      title: title,
      reason: reason
    })
    $statusLine.html('Deleted ' + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to delete ' + $link.prop('outerHTML') + '</b>: ' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

/**
 * Undelete a page (or, if the page exists, undelete deleted revisions). Admin-only function
 *
 * @param {string} title Title of the pgae to undelete
 * @param {string} reason Reason to log for the page undeletion
 */
async function spiHelperUndeletePage (title, reason) {
  'use strict'
  const activeOpKey = 'undelete_' + title
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(title)).attr('title', title).text(title)
  $statusLine.html('Undeleting ' + $link.prop('outerHTML'))

  const api = spiHelperGetAPI(title)
  try {
    await api.postWithToken('csrf', {
      action: 'undelete',
      title: title,
      reason: reason
    })
    $statusLine.html('Undeleted ' + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to undelete ' + $link.prop('outerHTML') + '</b>: ' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

/**
 * Render a snippet of wikitext
 *
 * @param {string} title Page title
 * @param {string} text Text to render
 * @return {Promise<string>} Rendered version of the text
 */
async function spiHelperRenderText (title, text) {
  'use strict'

  const request = {
    action: 'parse',
    prop: 'text',
    pst: 'true',
    text: text,
    title: title
  }

  try {
    const response = await spiHelperGetAPI(title).get(request)
    return response.parse.text['*']
  } catch (error) {
    console.error('Error rendering text: ' + error)
    return ''
  }
}

/**
 * Get a list of investigations on the sockpuppet investigation page
 *
 * @return {Promise<Object[]>} An array of section objects, each section is a separate investigation
 */
async function spiHelperGetInvestigationSectionIDs () {
  // Uses the parse API to get page sections, then find the investigation
  // sections (should all be level-3 headers)
  'use strict'

  // Since this only affects the local page, no need to call spiHelper_getAPI()
  const api = new mw.Api()
  const response = await api.get({
    action: 'parse',
    prop: 'sections',
    page: spiHelperPageName
  })
  const dateSections = []
  for (let i = 0; i < response.parse.sections.length; i++) {
    // TODO: also check for presence of spi case status
    if (parseInt(response.parse.sections[i].level) === 3) {
      dateSections.push(response.parse.sections[i])
    }
  }
  return dateSections
}

/**
 * Get SPI page backlinks to this SPI page.
 * Used to fix double redirects when merging cases.
 */
async function spiHelperGetSPIBacklinks (casePageName) {
  // Only looking for enwiki backlinks
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      list: 'backlinks',
      bltitle: casePageName,
      blnamespace: '4',
      bldir: 'ascending',
      blfilterredir: 'nonredirects'
    })
    return response.query.backlinks.filter((dictEntry) => {
      return dictEntry.title.startsWith('Wikipedia:Sockpuppet investigations/') && !dictEntry.title.startsWith('Wikipedia:Sockpuppet investigations/SPI/') && !dictEntry.title.match('Wikipedia:Sockpuppet investigations/.*/Archive.*')
    })
  } catch (error) {
    return []
  }
}

/**
 * Get the page protection level for a SPI page.
 * Used to keep the protection level after a history merge
 */
async function spiHelperGetProtectionInformation (casePageName) {
  // Only looking for enwiki protection information
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      prop: 'info',
      titles: casePageName,
      inprop: 'protection'
    })
    return response.query.pages[Object.keys(response.query.pages)[0]].protection
  } catch (error) {
    return []
  }
}

/**
 * Gets stabilisation settings information for a page. If no pending changes exists then it returns false.
 */
async function spiHelperGetStabilisationSettings (casePageName) {
  // Only looking for enwiki stabilisation information
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      prop: 'flagged',
      titles: casePageName
    })
    const entry = response.query.pages[Object.keys(response.query.pages)[0]]
    if ('flagged' in entry) {
      return entry.flagged
    } else {
      return false
    }
  } catch (error) {
    return false
  }
}

async function spiHelperProtectPage (casePageName, protections) {
  // Only lookint to protect pages on enwiki

  const activeOpKey = 'protect_' + casePageName
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  const $link = $('<a>').attr('href', mw.util.getUrl(casePageName)).attr('title', casePageName).text(casePageName)
  $statusLine.html('Protecting ' + $link.prop('outerHTML'))

  const api = new mw.Api()
  try {
    let protectlevelinfo = ''
    let expiryinfo = ''
    protections.forEach((dict) => {
      if (protectlevelinfo !== '') {
        protectlevelinfo = protectlevelinfo + '|'
        expiryinfo = expiryinfo + '|'
      }
      protectlevelinfo = protectlevelinfo + dict.type + '=' + dict.level
      expiryinfo = expiryinfo + dict.expiry
    })
    await api.postWithToken('csrf', {
      action: 'protect',
      format: 'json',
      title: casePageName,
      protections: protectlevelinfo,
      expiry: expiryinfo,
      reason: 'Restoring protection after history merge'
    })
    $statusLine.html('Protected ' + $link.prop('outerHTML'))
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    $statusLine.addClass('spihelper-errortext').html('<b>Failed to protect ' + $link.prop('outerHTML') + '</b>: ' + error)
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

async function spiHelperConfigurePendingChanges (casePageName, protectionLevel, protectionExpiry) {
  // Only lookint to protect pages on enwiki

  const activeOpKey = 'stabilize_' + casePageName
  spiHelperActiveOperations.set(activeOpKey, 'running')

  const api = new mw.Api()
  try {
    await api.postWithToken('csrf', {
      action: 'stabilize',
      format: 'json',
      titles: casePageName,
      protectlevel: protectionLevel,
      expiry: protectionExpiry,
      reason: 'Restoring pending changes protection after history merge'
    })
    spiHelperActiveOperations.set(activeOpKey, 'success')
  } catch (error) {
    spiHelperActiveOperations.set(activeOpKey, 'failed')
  }
}

async function spiHelperGetSiteRestrictionInformation () {
  // For enwiki only as this is it's only use case
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'query',
      format: 'json',
      meta: 'siteinfo',
      siprop: 'restrictions'
    })
    return response.query.restrictions
  } catch (error) {
    return []
  }
}

/**
 * Parse given text as wikitext without it needing to be currently saved onwiki.
 *
 */
async function spiHelperParseWikitext (wikitext) {
  // For enwiki only for now
  const api = new mw.Api()
  try {
    const response = await api.get({
      action: 'parse',
      prop: 'text',
      text: wikitext,
      wrapoutputclass: '',
      disablelimitreport: 1,
      disableeditsection: 1,
      contentmodel: 'wikitext'
    })
    return response.parse.text['*']
  } catch (error) {
    return ''
  }
}

/**
 * Returns true if the date provided is a valid date for strtotime in PHP (determined by using the time parser function and a parse API call)
 */
async function spiHelperValidateDate (dateInStringFormat) {
  const response = await spiHelperParseWikitext('{{#time:r|' + dateInStringFormat + '}}')
  return !response.includes('Error: Invalid time.')
}

/**
 * Pretty obvious - gets the name of the archive. This keeps us from having to regen it
 * if we rename the case
 *
 * @return {string} Name of the archive page
 */
function spiHelperGetArchiveName () {
    return spiHelperPageName + '/Archive'
}

function spiHelperIsAdmin () {
  if (spiHelperSettings.debugForceAdminState !== null) {
    return spiHelperSettings.debugForceAdminState
  }
  return mw.config.get('wgUserGroups').includes('sysop')
}

/**
 * Whether the current user has checkuser permissions, used to determine
 * whether to show checkuser options
 *
 * @return {boolean} Whether the current user is a checkuser
 */

function spiHelperIsCheckuser () {
  if (spiHelperSettings.debugForceCheckuserState !== null) {
    return spiHelperSettings.debugForceCheckuserState
  }
  return mw.config.get('wgUserGroups').includes('checkuser')
}

/**
 * Whether the current user is a clerk, used to determine whether to show
 * clerk options
 *
 * @return {boolean} Whether the current user is a clerk
 */
function spiHelperIsClerk () {
  // Assumption: checkusers should see clerk options. Please don't prove this wrong.
  return spiHelperSettings.clerk || spiHelperIsCheckuser()
}

/**
 * Common username normalization function
 * @param {string} username Username to normalize
 *
 * @return {string} Normalized username
 */
function spiHelperNormalizeUsername (username) {
  // Get rid of bad hidden characters
  username = username.replace(spiHelperHiddenCharNormRegex, '')
  // Remove leading and trailing spaces
  username = username.trim()
  if (mw.util.isIPAddress(username, true)) {
    // For IP addresses, capitalize them (really only applies to IPv6)
    username = username.toUpperCase()
  } else if (username) {
    // For actual usernames, make sure the first letter is capitalized
    // Ensure consistent case conversions with PHP as per https://phabricator.wikimedia.org/T292824
    username = new mw.Title(username).getMainText()
  }
  return username
}

/**
 * Parse key features from an archivenotice
 * @param {string} page Page to parse
 *
 * @return {Promise<ParsedArchiveNotice>} Parsed archivenotice
 */
async function spiHelperParseArchiveNotice (page) {
  const pagetext = await spiHelperGetPageText(page, false)
  const match = spiHelperArchiveNoticeRegex.exec(pagetext)
  if (match === null) {
    console.error('Missing archive notice')
    return { username: null, deny: null, xwiki: null, notalk: null }
  }
  const username = match[1]
  let deny = false
  let xwiki = false
  let notalk = false
  if (match[2]) {
    for (const entry of match[2].split('|')) {
      if (!entry) {
        // split in such a way that it's just a pipe
        continue
      }
      const splitEntry = entry.split('=')
      if (splitEntry.length !== 2) {
        console.error('Malformed archivenotice parameter ' + entry)
        continue
      }
      const key = splitEntry[0]
      const val = splitEntry[1]
      if (val.toLowerCase() !== 'yes') {
        // Only care if the value is 'yes'
        continue
      }
      if (key.toLowerCase() === 'deny') {
        deny = true
      } else if (key.toLowerCase() === 'crosswiki') {
        xwiki = true
      } else if (key.toLowerCase() === 'notalk') {
        notalk = true
      }
    }
  }
  /** @type {ParsedArchiveNotice} */
  return {
    username: username,
    deny: deny,
    xwiki: xwiki,
    notalk: notalk
  }
}

/**
 * Helper function to make a new archivenotice
 * @param {string} username Username
 * @param {ParsedArchiveNotice} archiveNoticeParams Other archivenotice params
 *
 * @return {string} New archivenotice
 */
function spiHelperMakeNewArchiveNotice (username, archiveNoticeParams) {
  let notice = '{{SPIarchive notice|1=' + username
  if (archiveNoticeParams.xwiki) {
    notice += '|crosswiki=yes'
  }
  if (archiveNoticeParams.deny) {
    notice += '|deny=yes'
  }
  if (archiveNoticeParams.notalk) {
    notice += '|notalk=yes'
  }
  notice += '}}'

  return notice
}

/**
 * Function to add a blank user line to the block table
 *
 * Would fail ESlint no-unused-vars due to only being
 * referenced in an onclick event
 *
 * @return {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
async function spiHelperAddBlankUserLine (tableName) {
  if (tableName === 'block') {
    spiHelperBlockTableUserCount++
    await spiHelperGenerateBlockTableLine('', true, spiHelperBlockTableUserCount)
  } else {
    spiHelperLinkTableUserCount++
    await spiHelperGenerateLinksTableLine('', spiHelperLinkTableUserCount)
  }
  updateForRole()
}
