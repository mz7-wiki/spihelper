// Main orchestration functions for spihelper
// This module contains the main action orchestrator and initialization

// Initialize settings that depend on other functions
spiHelperSettings.useCheckuserblockAccount = spiHelperIsCheckuser()

async function spiHelperOneClickArchive () {
  'use strict'  
  spiHelperActiveOperations.set('oneClickArchive', 'running')

  const pagetext = await spiHelperGetPageText(spiHelperPageName, false)
  spiHelperCaseSections = await spiHelperGetInvestigationSectionIDs()
  if (!spiHelperSectionRegex.test(pagetext)) {
    alert('Looks like the page has been archived already.')
    spiHelperActiveOperations.set('oneClickArchive', 'successful')
    return
  }
  displayMessage('<ul id="spiHelper_status"/>')
  await spiHelperArchiveCase()
  await spiHelperPurgePage(spiHelperPageName)
  const logMessage = '* [[' + spiHelperPageName + ']]: used one-click archiver ~~~~~'
  if (spiHelperSettings.log) {
    spiHelperLog(logMessage)
  }
  $('#spiHelper_status', document).append($('<li>').text('Done!'))
  spiHelperActiveOperations.set('oneClickArchive', 'successful')
}

/**
 * Given a tag entry, runs the required logic and tags the user
 * @param {TagEntry} tagEntry Tag entry to run the logic for
 * @param {boolean} tagNonLocalAccounts Whether to tag accounts that don't exist locally
 * @param {string} sockmaster The username of the sockmaster to tag for
 * @param {string} altmaster The username of the alternate master to tag for
 * @return {Promise<boolean>} Whether the tag was successfully applied
 */

async function spiHelperPerformActions () {
  'use strict'
  spiHelperActiveOperations.set('mainActions', 'running')

  // Again, reduce the search scope
  const $actionView = $('#spiHelper_actionViewDiv', document)

  // set up a few function-scoped vars
  let comment = ''
  let cuBlock = false
  let cuBlockOnly = false
  let newCaseStatus = 'noaction'
  let renameTarget = ''

  /** @type {boolean} */
  const blankTalk = $('#spiHelper_blanktalk', $actionView).prop('checked')
  /** @type {boolean} */
  const overrideExisting = $('#spiHelper_override', $actionView).prop('checked')
  /** @type {boolean} */
  const hideLockNames = $('#spiHelper_hidelocknames', $actionView).prop('checked')

  if (spiHelperActionsSelected.Case_act) {
    newCaseStatus = $('#spiHelper_CaseAction', $actionView).val().toString()
  }
  if (spiHelperActionsSelected.SpiMgmt) {
    spiHelperArchiveNoticeParams.deny = $('#spiHelper_spiMgmt_deny', $actionView).prop('checked')
    spiHelperArchiveNoticeParams.xwiki = $('#spiHelper_spiMgmt_crosswiki', $actionView).prop('checked')
    spiHelperArchiveNoticeParams.notalk = $('#spiHelper_spiMgmt_notalk', $actionView).prop('checked')
  }
  if (spiHelperSectionId && !spiHelperIsThisPageAnArchive) {
    comment = $('#spiHelper_CommentText', $actionView).val().toString()
  }
  if (spiHelperActionsSelected.Block) {
    if (spiHelperIsCheckuser()) {
      cuBlock = $('#spiHelper_cublock', $actionView).prop('checked')
      cuBlockOnly = $('#spiHelper_cublockonly', $actionView).prop('checked')
    }
    if (spiHelperIsAdmin() && !$('#spiHelper_noblock', $actionView).prop('checked')) {
      const masterNotice = $('#spiHelper_blocknoticemaster', $actionView).prop('checked')
      const sockNotice = $('#spiHelper_blocknoticesocks', $actionView).prop('checked')
      for (let i = 1; i <= spiHelperBlockTableUserCount; i++) {
        if ($('#spiHelper_block_doblock' + i, $actionView).prop('checked')) {
          const usernameValue = $('#spiHelper_block_username' + i, $actionView).val()
          if (!usernameValue) {
            // Skip blank usernames, empty string is falsey
            continue
          }
          let noticetype = ''

          const username = spiHelperNormalizeUsername(usernameValue.toString())

          if (masterNotice && ($('#spiHelper_block_tag' + i, $actionView).val().toString().includes('master') ||
                spiHelperNormalizeUsername(spiHelperCaseName) === username)) {
            noticetype = 'master'
          } else if (sockNotice) {
            noticetype = 'sock'
          }

          /** @type {BlockEntry} */
          const item = {
            username: username,
            duration: $('#spiHelper_block_duration' + i, $actionView).val().toString(),
            acb: $('#spiHelper_block_acb' + i, $actionView).prop('checked'),
            ab: $('#spiHelper_block_ab' + i, $actionView).prop('checked'),
            ntp: $('#spiHelper_block_tp' + i, $actionView).prop('checked'),
            nem: $('#spiHelper_block_email' + i, $actionView).prop('checked'),
            tpn: noticetype
          }
          spiHelperBlocks.push(item)
        }
        if ($('#spiHelper_block_lock' + i, $actionView).prop('checked')) {
          spiHelperGlobalLocks.push($('#spiHelper_block_username' + i, $actionView).val().toString())
        }
        if ($('#spiHelper_block_tag' + i).val() !== '') {
          if (!$('#spiHelper_block_username' + i, $actionView).val().toString()) {
            // Skip blank entries
            continue
          }
          const item = {
            username: spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString()),
            tag: $('#spiHelper_block_tag' + i, $actionView).val().toString(),
            altmasterTag: $('#spiHelper_block_tag_altmaster' + i, $actionView).val().toString(),
            blocking: $('#spiHelper_block_doblock' + i, $actionView).prop('checked')
          }
          spiHelperTags.push(item)
        }
      }
    } else {
      for (let i = 1; i <= spiHelperBlockTableUserCount; i++) {
        if (!$('#spiHelper_block_username' + i, $actionView).val().toString()) {
          // Skip blank entries
          continue
        }
        if ($('#spiHelper_block_tag' + i, $actionView).val() !== '') {
          const item = {
            username: spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString()),
            tag: $('#spiHelper_block_tag' + i, $actionView).val().toString(),
            altmasterTag: $('#spiHelper_block_tag_altmaster' + i, $actionView).val().toString(),
            blocking: false
          }
          spiHelperTags.push(item)
        }
        if ($('#spiHelper_block_lock' + i, $actionView).prop('checked')) {
          spiHelperGlobalLocks.push(spiHelperNormalizeUsername($('#spiHelper_block_username' + i, $actionView).val().toString()))
        }
      }
    }
  }
  if (spiHelperActionsSelected.Close) {
    spiHelperActionsSelected.Close = $('#spiHelper_CloseCase', $actionView).prop('checked')
  }
  if (spiHelperActionsSelected.Rename) {
    renameTarget = spiHelperNormalizeUsername($('#spiHelper_moveTarget', $actionView).val().toString())
  }
  if (spiHelperActionsSelected.Archive) {
    spiHelperActionsSelected.Archive = $('#spiHelper_ArchiveCase', $actionView).prop('checked')
  }

  displayMessage('<div id="linkViewResults" hidden><h4>Generated links</h4><ul id="linkViewResultsList"></ul></div><h4>Running actions</h4><ul id="spiHelper_status" />')

  const $statusAnchor = $('#spiHelper_status', document)

  let sectionText = await spiHelperGetPageText(spiHelperPageName, true, spiHelperSectionId)
  let editsummary = ''
  let logMessage = '* [[' + spiHelperPageName + ']]'
  if (spiHelperSectionId) {
    logMessage += ' (section ' + spiHelperSectionName + ')'
  } else {
    logMessage += ' (full case)'
  }
  logMessage += ' ~~~~~'

  if (spiHelperActionsSelected.Link) {
    $('#linkViewResults', document).show()
    const spiHelperUsersForLinks = {
      editorInteractionAnalyser: [],
      interactionTimeline: [],
      timecardSPITools: [],
      consolidatedTimelineSPITools: [],
      pagesSPITools: [],
      checkUserWikiSearch: []
    }
    for (let i = 1; i <= spiHelperLinkTableUserCount; i++) {
      const username = $('#spiHelper_link_username' + i, $actionView).val().toString()
      if (!username) {
        // Skip blank usernames
        continue
      }
      if ($('#spiHelper_link_editorInteractionAnalyser' + i, $actionView).prop('checked')) spiHelperUsersForLinks.editorInteractionAnalyser.push(username)
      if ($('#spiHelper_link_interactionTimeline' + i, $actionView).prop('checked')) spiHelperUsersForLinks.interactionTimeline.push(username)
      if ($('#spiHelper_link_timecardSPITools' + i, $actionView).prop('checked')) spiHelperUsersForLinks.timecardSPITools.push(username)
      if ($('#spiHelper_link_consolidatedTimelineSPITools' + i, $actionView).prop('checked')) spiHelperUsersForLinks.consolidatedTimelineSPITools.push(username)
      if ($('#spiHelper_link_pagesSPITools' + i, $actionView).prop('checked')) spiHelperUsersForLinks.pagesSPITools.push(username)
      if ($('#spiHelper_link_checkUserWikiSearch' + i, $actionView).prop('checked')) spiHelperUsersForLinks.checkUserWikiSearch.push(username)
    }

    const $linkViewList = $('#linkViewResultsList', document)
    for (const link in spiHelperUsersForLinks) {
      if (spiHelperUsersForLinks[link].length === 0) continue
      const URLentry = spiHelperLinkViewURLFormats[link]
      let generatedURL = URLentry.baseurl + '?' + (URLentry.multipleUserQueryStringKeys ? '' : URLentry.userQueryStringKey + '=')
      for (let i = 0; i < spiHelperUsersForLinks[link].length; i++) {
        const username = spiHelperUsersForLinks[link][i]
        generatedURL += (i === 0 ? '' : URLentry.userQueryStringSeparator)
        if (URLentry.multipleUserQueryStringKeys) {
          generatedURL += URLentry.userQueryStringKey + '=' + URLentry.userQueryStringWrapper + encodeURIComponent(username) + URLentry.userQueryStringWrapper
        } else {
          generatedURL += URLentry.userQueryStringWrapper + encodeURIComponent(username) + URLentry.userQueryStringWrapper
        }
      }
      generatedURL += (URLentry.appendToQueryString === '' ? '' : '&') + URLentry.appendToQueryString
      const $statusLine = $('<li>').appendTo($linkViewList)
      const $statusLineLink = $('<a>').appendTo($statusLine)
      $statusLineLink.attr('href', generatedURL).attr('target', '_blank').attr('rel', 'noopener noreferrer').text(spiHelperLinkViewURLFormats[link].name)
    }
  }

  if (spiHelperSectionId !== null && !spiHelperIsThisPageAnArchive) {
    let caseStatusResult = spiHelperCaseStatusRegex.exec(sectionText)
    if (caseStatusResult === null) {
      sectionText = sectionText.replace(/^(\s*===.*===[^\S\r\n]*)/, '$1\n{{SPI case status|}}')
      caseStatusResult = spiHelperCaseStatusRegex.exec(sectionText)
    }
    const oldCaseStatus = caseStatusResult[1] || 'open'
    if (newCaseStatus === 'noaction') {
      newCaseStatus = oldCaseStatus
    }

    if (spiHelperActionsSelected.Case_act && newCaseStatus !== 'noaction' && newCaseStatus !== oldCaseStatus) {
      switch (newCaseStatus) {
        case 'reopen':
          newCaseStatus = 'open'
          editsummary = 'Reopening'
          break
        case 'open':
          editsummary = 'Marking request as open'
          break
        case 'CUrequest':
          editsummary = 'Adding checkuser request'
          break
        case 'admin':
          editsummary = 'Requesting admin action'
          break
        case 'clerk':
          editsummary = 'Requesting clerk action'
          break
        case 'selfendorse':
          newCaseStatus = 'endorse'
          editsummary = 'Adding checkuser request (self-endorsed for checkuser attention)'
          break
        case 'checked':
          editsummary = 'Marking request as checked'
          break
        case 'inprogress':
          editsummary = 'Marking request in progress'
          break
        case 'decline':
          editsummary = 'Declining checkuser'
          break
        case 'cudecline':
          editsummary = 'CU declining checkuser'
          break
        case 'endorse':
          editsummary = 'Endorsing for checkuser attention'
          break
        case 'cuendorse':
          editsummary = 'CU endorsing for checkuser attention'
          break
        case 'moreinfo': // Intentional fallthrough
        case 'cumoreinfo':
          editsummary = 'Requesting additional information'
          break
        case 'relist':
          editsummary = 'Relisting case for another check'
          break
        case 'hold':
          editsummary = 'Putting case on hold'
          break
        case 'cuhold':
          editsummary = 'Placing checkuser request on hold'
          break
        case 'noaction':
          // Do nothing
          break
        default:
          console.error('Unexpected case status value ' + newCaseStatus)
      }
      logMessage += '\n** changed case status from ' + oldCaseStatus + ' to ' + newCaseStatus
    }
  }

  if (spiHelperActionsSelected.SpiMgmt) {
    const newArchiveNotice = spiHelperMakeNewArchiveNotice(spiHelperCaseName, spiHelperArchiveNoticeParams)
    sectionText = sectionText.replace(spiHelperArchiveNoticeRegex, newArchiveNotice)
    if (editsummary) {
      editsummary += ', update archivenotice'
    } else {
      editsummary = 'Update archivenotice'
    }
    logMessage += '\n** Updated archivenotice'
  }

  let loggingPromise = Promise.all([Promise.resolve()])
  // Possibly build these inside the promises themselves?
  const loggingArrays = {
    blocked: [], tagged: []
  }
  if (spiHelperActionsSelected.Block) {
    let sockmaster = ''
    let altmaster = ''
    let needsAltmaster = false
    spiHelperTags.forEach(async (tagEntry) => {
      // we do not support tagging IPs
      if (mw.util.isIPAddress(tagEntry.username, true)) {
        // Skip, this is an IP
        return
      }
      if (tagEntry.tag.includes('master')) {
        sockmaster = tagEntry.username
      }
      if (tagEntry.altmasterTag !== '') {
        needsAltmaster = true
      }
    })
    if (sockmaster === '') {
      sockmaster = prompt('Please enter the name of the sockmaster: ', spiHelperCaseName) || spiHelperCaseName
    }
    if (needsAltmaster) {
      altmaster = prompt('Please enter the name of the alternate sockmaster: ', spiHelperCaseName) || spiHelperCaseName
    }
    
    const tagNonLocalAccounts = $('#spiHelper_tagAccountsWithoutLocalAccount', $actionView).prop('checked')
    let blockingPromises
    if (spiHelperIsAdmin()) {
      // Block, then tag
      blockingPromises = Promise.all(spiHelperBlocks.map(async (blockEntry) => {
        await spiHelperBlockUser(blockEntry, cuBlock, cuBlockOnly, overrideExisting, blankTalk, sockmaster).then(async (success) => {
          if (success) {
            loggingArrays.blocked.push('{{noping|' + blockEntry.username + '}}')
          }

          const tagEntry = spiHelperTags.find((tag) => tag.username === blockEntry.username)
          if (typeof tagEntry !== 'undefined') {
            await spiHelperTagUser(tagEntry, tagNonLocalAccounts, sockmaster, altmaster).then((success) => {
              if (success) {
                loggingArrays.tagged.push('{{noping|' + tagEntry.username + '}}')
              }
            })
          }
        })
      }))
    }
    const taggingPromises = Promise.all(spiHelperTags.map(async (tagEntry) => {
      if (tagEntry.blocking) {
        return
      }
      await spiHelperTagUser(tagEntry, tagNonLocalAccounts, sockmaster, altmaster).then((success) => {
        if (success) {
          loggingArrays.tagged.push('{{noping|' + tagEntry.username + '}}')
        }
      })
    }))

    if (sockmaster) {
      // Whether we should purge sock pages (needed when we create a category)
      let needsPurge = false
      // True for each we need to check if the respective category (e.g.
      // "Suspected sockpuppets of Test") exists
      const checkConfirmedCat = spiHelperTags.some((tagEntry) => tagEntry.tag === 'proven') || spiHelperTags.some((tagEntry) => tagEntry.tag === 'confirmed')
      const checkSuspectedCat = spiHelperTags.some((tagEntry) => tagEntry.tag === 'blocked')
      const checkAltSuspectedCat = altmaster !== '' ? spiHelperTags.some((tagEntry) => tagEntry.altmasterTag !== '' && tagEntry.altmasterTag === 'suspected') : false
      const checkAltConfirmedCat = altmaster !== '' ? spiHelperTags.some((tagEntry) => tagEntry.altmasterTag !== '' && tagEntry.altmasterTag === 'proven') || spiHelperTags.some((tagEntry) => tagEntry.altmasterTag !== '' && tagEntry.altmasterTag === 'confirmed') : false

      if (checkAltConfirmedCat) {
        const catname = 'Category:Wikipedia sockpuppets of ' + altmaster
        const cattext = await spiHelperGetPageText(catname, false)
        // Empty text means the page doesn't exist - create it
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            'Creating sockpuppet category per [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      if (checkAltSuspectedCat) {
        const catname = 'Category:Suspected Wikipedia sockpuppets of ' + altmaster
        const cattext = await spiHelperGetPageText(catname, false)
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            'Creating sockpuppet category per [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      if (checkConfirmedCat) {
        const catname = 'Category:Wikipedia sockpuppets of ' + sockmaster
        const cattext = await spiHelperGetPageText(catname, false)
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            'Creating sockpuppet category per [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      if (checkSuspectedCat) {
        const catname = 'Category:Suspected Wikipedia sockpuppets of ' + sockmaster
        const cattext = await spiHelperGetPageText(catname, false)
        if (!cattext) {
          await spiHelperEditPage(catname, '{{sockpuppet category}}',
            'Creating sockpuppet category per [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
            true, spiHelperSettings.watchNewCats, spiHelperSettings.watchNewCatsExpiry)
          needsPurge = true
        }
      }
      // Purge the sock pages if we created a category (to get rid of
      // the issue where the page says "click here to create category"
      // when the category was created after the page)
      if (needsPurge) {
        spiHelperTags.forEach((tagEntry) => {
          if (mw.util.isIPAddress(tagEntry.username, true)) {
            // Skip, this is an IP
            return
          }
          if (!tagEntry.tag && !tagEntry.altmasterTag) {
            // Skip, not tagged
            return
          }
          // Not bothering with an await, no need for async behavior here
          spiHelperPurgePage('User:' + tagEntry.username)
        })
      }
    }

    if (spiHelperGlobalLocks.length > 0) {
      let locked = ''
      let templateContent = ''
      let matchCount = 0
      spiHelperGlobalLocks.forEach(async (globalLockEntry) => {
        // do not support locking IPs (those are global blocks, not
        // locks, and are handled a bit differently)
        if (mw.util.isIPAddress(globalLockEntry, true)) {
          return
        }
        templateContent += '|' + (matchCount + 1) + '=' + globalLockEntry
        if (locked) {
          locked += ', '
        }
        locked += '{{noping|1=' + globalLockEntry + '}}'
        matchCount++
      })

      if (matchCount > 0) {
        if (hideLockNames) {
          // If requested, hide locked names
          templateContent += '|hidename=1'
        }
        // Parts of this code were adapted from https://github.com/Xi-Plus/twinkle-global
        let lockTemplate = ''
        if (matchCount === 1) {
          lockTemplate = '* {{LockHide' + templateContent + '}}'
        } else {
          lockTemplate = '* {{MultiLock' + templateContent + '}}'
        }
        if (!sockmaster) {
          sockmaster = prompt('Please enter the name of the sockmaster: ', spiHelperCaseName) || spiHelperCaseName
        }
        const usePlural = matchCount > 1
        const lockComment = prompt('Please enter a comment for the global lock request (optional):', '') || ''
        const heading = hideLockNames ? (usePlural ? 'sockpuppets' : 'sockpuppet') : '[[Special:CentralAuth/' + sockmaster + '|' + sockmaster + ']] ' + (usePlural ? 'socks' : 'sock')
        let message = '=== Global lock for ' + heading + ' ==='
        message += '\n{{status}}'
        message += '\n' + lockTemplate
        message += '\n' + (usePlural ? 'Sockpuppets' : 'Sockpuppet') + ' found in enwiki sockpuppet investigation, see [[' + spiHelperInterwikiPrefix + spiHelperPageName + ']]. ' + lockComment + ' ~~~~'

        // Write lock request to [[meta:Steward requests/Global]]
        let srgText = await spiHelperGetPageText('meta:Steward requests/Global', false)
        srgText = srgText.replace(/\n+(== See also == *\n)/, '\n\n' + message + '\n\n$1')
        spiHelperEditPage('meta:Steward requests/Global', srgText, 'global lock request for ' + heading, false, 'nochange')
        $statusAnchor.append($('<li>').text('Filing global lock request'))
      }
      if (locked) {
        logMessage += '\n** requested locks for ' + locked
      }
    }

    loggingPromise = Promise.all([blockingPromises, taggingPromises])
  }
  if (spiHelperSectionId && comment && comment !== '*' && !spiHelperIsThisPageAnArchive) {
    if (!sectionText.includes('\n----')) {
      sectionText.replace('<!--- All comments go ABOVE this line, please. -->', '')
      sectionText.replace('<!-- All comments go ABOVE this line, please. -->', '')
      sectionText += '\n----<!-- All comments go ABOVE this line, please. -->'
    }
    if (!/~~~~/.test(comment)) {
      comment += ' ~~~~'
    }
    // Clerks and admins post in the admin section
    if (spiHelperIsClerk() || spiHelperIsAdmin()) {
      // Complicated regex to find the first regex in the admin section
      // The weird (\n|.) is because we can't use /s (dot matches newline) regex mode without ES9,
      // I don't want to go there yet
      sectionText = sectionText.replace(/\n*----(?!(\n|.)*----)/, '\n' + comment + '\n----')
    } else { // Everyone else posts in the "other users" section
      sectionText = sectionText.replace(spiHelperAdminSectionWithPrecedingNewlinesRegex,
        '\n' + comment + '\n====<big>Clerk, CheckUser, and/or patrolling admin comments</big>====\n')
    }
    if (editsummary) {
      editsummary += ', comment'
    } else {
      editsummary = 'Comment'
    }
    logMessage += '\n** commented'
  }

  if (spiHelperActionsSelected.Close) {
    newCaseStatus = 'close'
    if (editsummary) {
      editsummary += ', marking case as closed'
    } else {
      editsummary = 'Marking case as closed'
    }
    logMessage += '\n** closed case'
  }
  if (spiHelperSectionId !== null && !spiHelperIsThisPageAnArchive) {
    const caseStatusText = spiHelperCaseStatusRegex.exec(sectionText)[0]
    sectionText = sectionText.replace(caseStatusText, '{{SPI case status|' + newCaseStatus + '}}')
  }

  // Fallback: if we somehow managed to not make an edit summary, add a default one
  if (!editsummary) {
    editsummary = 'Saving page'
  }

  // Make all of the requested edits (synchronous since we might make more changes to the page), unless the page is an archive (as there should be no edits made)
  if (!spiHelperIsThisPageAnArchive) {
    const editResult = await spiHelperEditPage(spiHelperPageName, sectionText, editsummary, false,
      spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, spiHelperSectionId)
    if (!editResult) {
      // Page edit failed (probably an edit conflict), dump the comment if we had one
      if (comment && comment !== '*') {
        $('<li>')
          .append($('<div>').addClass('spihelper-errortext')
            .append($('<b>').text('SPI page edit failed! Comment was: ' + comment)))
          .appendTo($('#spiHelper_status', document))
      }
    }
  }
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
  if (spiHelperActionsSelected.Archive) {
    // Archive the case
    if (spiHelperSectionId === null) {
      // Archive the whole case
      logMessage += '\n** Archived case'      
      await spiHelperArchiveCase()
    } else {
      // Just archive the selected section
      logMessage += '\n** Archived section'      
      await spiHelperArchiveCaseSection(spiHelperSectionId)
    }
  } else if (spiHelperActionsSelected.Rename && renameTarget) {
    if (spiHelperSectionId === null) {
      // Option 1: we selected "All cases," this is a whole-case move/merge
      logMessage += '\n** moved/merged case to ' + renameTarget
      await spiHelperMoveCase(renameTarget)
    } else {
      // Option 2: this is a single-section case move or merge
      logMessage += '\n** moved section to ' + renameTarget
      await spiHelperMoveCaseSection(renameTarget, spiHelperSectionId)
    }
  }
  if (spiHelperSettings.log) {
    loggingPromise.then(async () => {
      if (loggingArrays.blocked.length > 0) {
        logMessage += '\n** blocked ' + loggingArrays.blocked.join(', ')
      }
      if (loggingArrays.tagged.length > 0) {
        logMessage += '\n** tagged ' + loggingArrays.tagged.join(', ')
      }
      await spiHelperLog(logMessage)
    })
  }

  await spiHelperPurgePage(spiHelperPageName)
  $('#spiHelper_status', document).append($('<li>').text('Done!'))
  spiHelperActiveOperations.set('mainActions', 'successful')
}

/**
 * Logs SPI actions to userspace a la Twinkle's CSD/prod/etc. logs
 *
 * @param {string} logString String with the changes the user made
 */
async function spiHelperLog (logString) {
  const now = new Date()
  const dateString = now.toLocaleString('en', { month: 'long' }) + ' ' +
    now.toLocaleString('en', { year: 'numeric' })
  const dateHeader = '==\\s*' + dateString + '\\s*=='
  const dateHeaderRe = new RegExp(dateHeader, 'i')
  const dateHeaderReWithAnyDate = /==.*?==/i

  let logPageText = await spiHelperGetPageText('User:' + mw.config.get('wgUserName') + '/spihelper_log', false)
  if (!logPageText.match(dateHeaderRe)) {
    if (spiHelperSettings.reversed_log) {
      const firstHeaderMatch = logPageText.match(dateHeaderReWithAnyDate)
      logPageText = logPageText.substring(0, firstHeaderMatch.index) + '== ' + dateString + ' ==\n' + logPageText.substring(firstHeaderMatch.index)
    } else {
      logPageText += '\n== ' + dateString + ' =='
    }
  }
  if (spiHelperSettings.reversed_log) {
    const firstHeaderMatch = logPageText.match(dateHeaderReWithAnyDate)
    logPageText = logPageText.substring(0, firstHeaderMatch.index + firstHeaderMatch[0].length) + '\n' + logString + logPageText.substring(firstHeaderMatch.index + firstHeaderMatch[0].length)
  } else {
    logPageText += '\n' + logString
  }
  await spiHelperEditPage('User:' + mw.config.get('wgUserName') + '/spihelper_log', logPageText, 'Logging spihelper edits', false, 'nochange')
}

// Major helper functions
/**
 * Cleanups following a rename - update the archive notice, add an archive notice to the
 * old case name, add the original sockmaster to the sock list for reference
 *
 * @param {string} oldCasePage Title of the previous case page
 */

async function spiHelperAddLink () {
  'use strict'
  await spiHelperLoadSettings()
  await mw.loader.load('mediawiki.util')
  const initLink = mw.util.addPortletLink('p-cactions', '#', 'SPI', 'ca-spiHelper')
  // The skin didn't have a p-cactions menu so the menu addition failed. Exit early.
  if (!initLink) {
    return false;
  }
  initLink.addEventListener('click', (e) => {
    e.preventDefault()
    return spiHelperInit()
  })
  if (mw.config.get('wgCategories').includes('SPI cases awaiting archive') && spiHelperIsClerk()) {
    const oneClickArchiveLink = mw.util.addPortletLink('p-cactions', '#', 'SPI-Archive', 'ca-spiHelperArchive')
    $(oneClickArchiveLink).one('click', (e) => {
      e.preventDefault()
      return spiHelperOneClickArchive()
    })
  }
  window.addEventListener('beforeunload', (e) => {
    const $actionView = $('#spiHelper_actionViewDiv', document)
    if ($actionView.length > 0) {
      e.preventDefault()
      // for Chrome
      e.returnValue = ''
      return true
    }

    // Make sure no operations are still in flight
    let isDirty = false
    spiHelperActiveOperations.forEach((value, _0, _1) => {
      if (value === 'running') {
        isDirty = true
      }
    })
    if (isDirty) {
      e.preventDefault()
      e.returnValue = ''
      return true
    }
  })
}

/**
 * Checks for the existence of Special:MyPage/spihelper-options.js, and if it exists,
 * loads the settings from that page.
 */
async function spiHelperLoadSettings () {
  // Dynamically load a user's settings
  // Borrowed from code I wrote for [[User:Headbomb/unreliable.js]]
  try {
    await mw.loader.getScript('/w/index.php?title=Special:MyPage/spihelper-options.js&action=raw&ctype=text/javascript')
    if (typeof spiHelperCustomOpts !== 'undefined') {
      const keys = Object.keys(spiHelperCustomOpts)
      for (let index = 0; index < keys.length; index++) {
        const k = keys[index]
        const v = spiHelperCustomOpts[k]
        if (k in spiHelperValidSettings) {
          if (spiHelperValidSettings[k].indexOf(v) === -1) {
            mw.log.warn('Invalid option given in spihelper-options.js for the setting ' + k.toString())
            continue
          }
        } else if (k in spiHelperSettingsNeedingValidDate) {
          if (!await spiHelperValidateDate(v)) {
            mw.log.warn('Invalid option given in spihelper-options.js for the setting ' + k.toString())
            continue
          }
        }
        spiHelperSettings[k] = v
      }
    }
  } catch (error) {
    mw.log.error('Error retrieving your spihelper-options.js')
    // More detailed error in the console
    console.error('Error getting local spihelper-options.js: ' + error)
  }
}

/* Actually put the portlets in place if needed */
if (mw.config.get('wgPageName').includes('Wikipedia:Sockpuppet_investigations/') &&
  !mw.config.get('wgPageName').includes('Wikipedia:Sockpuppet_investigations/SPI/')) {
  mw.loader.load('mediawiki.user')
  $(spiHelperAddLink)
}
