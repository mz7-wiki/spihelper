// Archive and move action functions for spihelper
// This module handles case archiving and moving/merging operations

async function spiHelperPostRenameCleanup (oldCasePage) {
  'use strict'
  const replacementArchiveNotice = spiHelperMakeNewArchiveNotice(spiHelperCaseName, spiHelperArchiveNoticeParams)
  const oldCaseName = oldCasePage.replace(/Wikipedia:Sockpuppet investigations\//g, '')

  // Update previous SPI redirects to this location
  const pagesChecked = []
  const pagesToCheck = [oldCasePage]
  let currentPageToCheck = null
  while (pagesToCheck.length !== 0) {
    currentPageToCheck = pagesToCheck.pop()
    if (currentPageToCheck === spiHelperPageName || currentPageToCheck === oldCasePage) {
      continue
    }
    pagesChecked.push(currentPageToCheck)
    const backlinks = await spiHelperGetSPIBacklinks(currentPageToCheck)
    for (let i = 0; i < backlinks.length; i++) {
      if ((await spiHelperParseArchiveNotice(backlinks[i].title)).username === currentPageToCheck.replace(/Wikipedia:Sockpuppet investigations\//g, '')) {
        spiHelperEditPage(backlinks[i].title, replacementArchiveNotice, 'Updating case following page move', false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
        if (pagesChecked.indexOf(backlinks[i].title) !== -1) {
          pagesToCheck.push(backlinks[i])
        }
      }
    }
  }

  // The old case should just be the archivenotice template and point to the new case
  spiHelperEditPage(oldCasePage, replacementArchiveNotice, 'Updating case following page move', false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)

  // The new case's archivenotice should be updated with the new name
  let newPageText = await spiHelperGetPageText(spiHelperPageName, true)
  newPageText = newPageText.replace(spiHelperArchiveNoticeRegex, '{{SPIarchive notice|1=' + spiHelperCaseName + '$2}}')
  // We also want to add the previous master to the sock list
  // We use SOCK_SECTION_RE_WITH_NEWLINE to clean up any extraneous whitespace
  newPageText = newPageText.replace(spiHelperSockSectionWithNewlineRegex, '====Suspected sockpuppets====' +
    '\n* {{checkuser|1=' + oldCaseName + '}} ({{clerknote}} original case name)\n')
  // Also remove the new master if they're in the sock list
  // This RE is kind of ugly. The idea is that we find everything from the level 4 heading
  // ending with "sockpuppets" to the level 4 heading beginning with <big> and pull the checkuser
  // template matching the current case name out. This keeps us from accidentally replacing a
  // checkuser entry in the admin section
  const newMasterReString = '(sockpuppets\\s*====.*?)\\n^\\s*\\*\\s*{{checkuser\\|(?:1=)?' + spiHelperCaseName + '(?:\\|master name\\s*=.*?)?}}\\s*$(.*====\\s*<big>)'
  const newMasterRe = new RegExp(newMasterReString, 'sm')
  newPageText = newPageText.replace(newMasterRe, '$1\n$2')

  await spiHelperEditPage(spiHelperPageName, newPageText, 'Updating case following page move', false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Cleanups following a merge - re-insert the original page text
 *
 * @param {string} originalText Text of the page pre-merge
 */
async function spiHelperPostMergeCleanup (originalText) {
  'use strict'
  let newText = await spiHelperGetPageText(spiHelperPageName, false)
  // Remove the SPI header templates from the page
  newText = newText.replace(/\n*<noinclude>__TOC__.*\n/ig, '')
  newText = newText.replace(spiHelperArchiveNoticeRegex, '')
  newText = newText.replace(spiHelperPriorCasesRegex, '')
  newText = originalText + '\n' + newText

  // Write the updated case
  await spiHelperEditPage(spiHelperPageName, newText, 'Re-adding previous cases following merge', false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Archive all closed sections of a case
 */
async function spiHelperArchiveCase () {  
  'use strict'  
  // Get the entire page text
  let pageText = await spiHelperGetPageText(spiHelperPageName, true)

  // Remove all {{SPI case status|close(d)}} templates from the page text
  pageText.replace(spiHelperCaseStatusClosedRegex, '')

  let textToArchiveLines = []
  let textToKeepLines = []
  let sectionLines = []

  // Now we will iterate line by line through pageText and decide if the line
  // should be appended to sectionsToArchiveLines, which we will then append to the archive.
  let inClosedSection = false
  for (const line of pageText.split('\n')) {
    if (spiHelperSectionRegex.test(line)) {
      // We found the start of an SPI case section
      if (inClosedSection) {
        textToArchiveLines.push(sectionLines.join('\n'))
      } else {
        textToKeepLines.push(sectionLines.join('\n'))
      }

      // reset sectionLines to hold the current section's text
      sectionLines = []

      // start by assuming that this section is closed
      inClosedSection = true
    }

    const case_status = line.match(spiHelperCaseStatusRegex)
    if (case_status && !spiHelperCaseClosedRegex.test(case_status[1])) {
      // this section is not in fact closed
      inClosedSection = false
    }

    sectionLines.push(line)
  }

  if (inClosedSection) {
    textToArchiveLines.push(sectionLines.join('\n'))
  } else {
    textToKeepLines.push(sectionLines.join('\n'))
  }

  const textToArchive = textToArchiveLines.join('\n')
  const textToKeep = textToKeepLines.join('\n')

  if (!textToArchive) {
    // Nothing to archive
    console.log("spihelper: nothing to archive here.")
    return
  }

  // A running concern with the SPI archives is whether they exceed the post-expand
  // include size. Calculate what percent of that size the archive will be if we
  // add the current page to it - if >1, we need to archive the archive
  const postExpandPercent =
    (await spiHelperGetPostExpandSize(spiHelperPageName) +
    await spiHelperGetPostExpandSize(spiHelperGetArchiveName())) /
    spiHelperGetMaxPostExpandSize()
  if (postExpandPercent >= 1) {
    // We'd overflow the archive, so move it and then archive the current page
    // Find the first empty archive page
    let archiveId = 1
    while (await spiHelperGetPageText(spiHelperGetArchiveName() + '/' + archiveId, false) !== '') {
      archiveId++
    }
    const newArchiveName = spiHelperGetArchiveName() + '/' + archiveId
    await spiHelperMovePage(spiHelperGetArchiveName(), newArchiveName, 'Moving archive to avoid exceeding post expand size limit', false, false)
    await spiHelperEditPage(spiHelperGetArchiveName(), '', 'Removing redirect', false, 'nochange')
  }

  // Update the archive
  let archivetext = await spiHelperGetPageText(spiHelperGetArchiveName(), true)
  if (!archivetext) {
    archivetext = '__TOC__\n{{SPIarchive notice|1=' + spiHelperCaseName + '}}\n{{SPIpriorcases}}'
  } else {
    archivetext = archivetext.replace(/<br\s*\/>\s*{{SPIpriorcases}}/gi, '\n{{SPIpriorcases}}') // fmt fix whenever needed.
  }
  archivetext += '\n' + textToArchive
  const archiveSuccess = await spiHelperEditPage(spiHelperGetArchiveName(), archivetext,
    'Archiving closed cases from [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
    false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)

  if (!archiveSuccess) {    
    $statusLine.addClass('spihelper-errortext').append('b').text('Failed to update archive, not removing section from case page')
    return
  }

  // Update case page to blank the sections we archived
  await spiHelperEditPage(spiHelperPageName, textToKeep, 'Archiving closed cases to [[' + spiHelperGetInterwikiPrefix() + spiHelperGetArchiveName() + ']]',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, null)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Archive a specific section of a case
 *
 * @param {!number} sectionId The section number to archive
 */
async function spiHelperArchiveCaseSection (sectionId) {
  'use strict'
  let sectionText = await spiHelperGetPageText(spiHelperPageName, true, sectionId)
  sectionText = sectionText.replace(spiHelperCaseStatusRegex, '')
  const newarchivetext = sectionText.substring(sectionText.search(spiHelperSectionRegex))  
  let archivetext = await spiHelperGetPageText(spiHelperGetArchiveName(), true)  

  const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
  //Edit conflict check
  if(archivetext.includes(sectionText)) {
    $statusLine.addClass('spihelper-errortext').append('b').text('Looks like the page has been archived already')
    return      
  }


  // Update the archive
  if (!archivetext) {
    archivetext = '__TOC__\n{{SPIarchive notice|1=' + spiHelperCaseName + '}}\n{{SPIpriorcases}}'
  } else {
    archivetext = archivetext.replace(/<br\s*\/>\s*{{SPIpriorcases}}/gi, '\n{{SPIpriorcases}}') // fmt fix whenever needed.
  }
  archivetext += '\n' + newarchivetext
  const archiveSuccess = await spiHelperEditPage(spiHelperGetArchiveName(), archivetext,
    'Archiving case section from [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
    false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)

  if (!archiveSuccess) {    
    $statusLine.addClass('spihelper-errortext').append('b').text('Failed to update archive, not removing section from case page')
    return
  }

  // Blank the section we archived
  await spiHelperEditPage(spiHelperPageName, '', 'Archiving case section to [[' + spiHelperGetInterwikiPrefix() + spiHelperGetArchiveName() + ']]',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, sectionId)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Move or merge the selected case into a different case
 *
 * @param {string} target The username portion of the case this section should be merged into
 *                        (should have been normalized before getting passed in)
 */
async function spiHelperMoveCase (target) {
  // Move or merge an entire case
  // Normalize: change underscores to spaces
  // target = target
  const newPageName = spiHelperPageName.replace(spiHelperCaseName, target)
  const targetPageText = await spiHelperGetPageText(newPageName, false)
  if (targetPageText) {
    if (spiHelperIsAdmin()) {
      const proceed = confirm('Target page exists, do you want to histmerge the cases?')
      if (!proceed) {
        // Build out the error line
        $('<li>')
          .append($('<div>').addClass('spihelper-errortext')
            .append($('<b>').text('Aborted merge.')))
          .appendTo($('#spiHelper_status', document))
        return
      }
    } else {
      $('<li>')
        .append($('<div>').addClass('spihelper-errortext')
          .append($('<b>').text('Target page exists and you are not an admin, aborting merge.')))
        .appendTo($('#spiHelper_status', document))
      return
    }
  }
  const oldPageName = spiHelperPageName
  if (newPageName === oldPageName) {
    $('<li>')
      .append($('<div>').addClass('spihelper-errortext')
        .append($('<b>').text('Target page is the current page, aborting merge.')))
      .appendTo($('#spiHelper_status', document))
    return
  }
  // Housekeeping to update all of the var names following the rename
  const oldArchiveName = spiHelperGetArchiveName()
  spiHelperCaseName = target
  spiHelperPageName = newPageName
  let archivesCopied = false
  if (targetPageText) {
    // There's already a page there, we're going to merge
    // First, check if there's an archive; if so, copy its text over
    const newArchiveName = spiHelperGetArchiveName().replace(spiHelperCaseName, target)
    let sourceArchiveText = await spiHelperGetPageText(oldArchiveName, false)
    let targetArchiveText = await spiHelperGetPageText(newArchiveName, false)
    if (sourceArchiveText && targetArchiveText) {
      $('<li>')
        .append($('<div>').text('Archive detected on both source and target cases, manually copying archive.'))
        .appendTo($('#spiHelper_status', document))

      // Normalize the source archive text
      sourceArchiveText = sourceArchiveText.replace(/^\s*__TOC__\s*$\n/gm, '')
      sourceArchiveText = sourceArchiveText.replace(spiHelperArchiveNoticeRegex, '')
      sourceArchiveText = sourceArchiveText.replace(spiHelperPriorCasesRegex, '')
      // Strip leading newlines
      sourceArchiveText = sourceArchiveText.replace(/^\n*/, '')
      targetArchiveText += '\n' + sourceArchiveText
      await spiHelperEditPage(newArchiveName, targetArchiveText, 'Copying archives from [[' + spiHelperGetInterwikiPrefix() + oldArchiveName + ']], see page history for attribution',
        false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)
      await spiHelperDeletePage(oldArchiveName, 'Deleting copied archive')
      archivesCopied = true
    }
    // Now get existing protection levels on the target and existing page.
    const oldPageNameProtection = await spiHelperGetProtectionInformation(oldPageName)
    const newPageNameProtection = await spiHelperGetProtectionInformation(spiHelperPageName)
    const newProtectionValues = []
    const siteProtectionInformation = await spiHelperGetSiteRestrictionInformation()
    // First find if both the old page and new page had the same protection type enabled
    siteProtectionInformation.types.forEach((type) => {
      let oldPageNameEntry = oldPageNameProtection.filter((dict) => { return dict.type === type })
      let newPageNameEntry = newPageNameProtection.filter((dict) => { return dict.type === type })
      if (oldPageNameEntry.length > 0 && newPageNameEntry.length > 0) {
        const newProtectionDict = { type: oldPageNameEntry.type }
        oldPageNameEntry = oldPageNameEntry[0]
        newPageNameEntry = newPageNameEntry[0]
        if (newPageNameEntry.expiry === 'infinity' || oldPageNameEntry.expiry === 'infinity' || newPageNameEntry.expiry === 'infinite' || oldPageNameEntry.expiry === 'infinite') {
          newProtectionDict.push({ expiry: 'infinite' })
        } else if (newPageNameEntry.expiry < oldPageNameEntry.expiry) {
          newProtectionDict.push({ expiry: oldPageNameEntry.expiry })
        } else {
          newProtectionDict.push({ expiry: newPageNameEntry.expiry })
        }
        const oldPageNameEntryLevelIndex = siteProtectionInformation.levels.indexOf(oldPageNameEntry.level)
        const newPageNameEntryLevelIndex = siteProtectionInformation.levels.indexOf(newPageNameEntry.level)
        if (oldPageNameEntryLevelIndex === -1 || newPageNameEntryLevelIndex === -1) {
          console.error('Invalid protection information provided from API')
          return
        } else if (oldPageNameEntryLevelIndex > newPageNameEntryLevelIndex) {
          newProtectionDict.push({ level: oldPageNameEntry.level })
        } else if (oldPageNameEntryLevelIndex <= newPageNameEntryLevelIndex) {
          newProtectionDict.push({ level: newPageNameEntry.level })
        }
        newProtectionValues.push(newProtectionDict)
      } else if (oldPageNameEntry.length > 0) {
        newProtectionValues.push(oldPageNameEntry[0])
      } else if (newPageNameEntry.length > 0) {
        newProtectionValues.push(newPageNameEntry[0])
      }
    })
    // Now handle pending changes protection
    const oldPageNameStabilisation = await spiHelperGetStabilisationSettings(oldPageName)
    const newPageNameStabilisation = await spiHelperGetStabilisationSettings(spiHelperPageName)
    let newStabilisationSettings = { protection_level: '' }
    if (oldPageNameStabilisation !== false && newPageNameStabilisation !== false) {
      // Pending changes is used on both pages
      if (newPageNameStabilisation.protection_expiry === 'infinity' || oldPageNameStabilisation.protection_expiry === 'infinity' || newPageNameStabilisation.protection_expiry === 'infinite' || oldPageNameStabilisation.protection_expiry === 'infinite') {
        newStabilisationSettings.push({ protection_expiry: 'infinite' })
      } else if (newPageNameStabilisation.protection_expiry < oldPageNameStabilisation.expiry) {
        newStabilisationSettings.push({ protection_expiry: oldPageNameStabilisation.protection_expiry })
      } else {
        newStabilisationSettings.push({ protection_expiry: newPageNameStabilisation.protection_expiry })
      }
      const oldPageNameEntryLevelIndex = siteProtectionInformation.levels.indexOf(oldPageNameStabilisation.protection_level)
      const newPageNameEntryLevelIndex = siteProtectionInformation.levels.indexOf(newPageNameStabilisation.protection_level)
      if (oldPageNameEntryLevelIndex === -1 || newPageNameEntryLevelIndex === -1) {
        console.error('Invalid protection information provided from API')
        return
      } else if (oldPageNameEntryLevelIndex > newPageNameEntryLevelIndex) {
        newStabilisationSettings.push({ level: oldPageNameStabilisation.protection_level })
      } else if (oldPageNameEntryLevelIndex <= newPageNameEntryLevelIndex) {
        newStabilisationSettings.push({ level: newPageNameStabilisation.protection_level })
      }
    } else if (oldPageNameStabilisation !== false) {
      newStabilisationSettings = oldPageNameStabilisation
    } else if (newPageNameStabilisation !== false) {
      newStabilisationSettings = newPageNameStabilisation
    }
    // Ignore warnings on the move, we're going to get one since we're stomping an existing page
    await spiHelperDeletePage(spiHelperPageName, 'Deleting as part of case merge')
    await spiHelperMovePage(oldPageName, spiHelperPageName, 'Merging case to [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]', true)
    await spiHelperUndeletePage(spiHelperPageName, 'Restoring page history after merge')
    if (archivesCopied) {
      // Create a redirect
      spiHelperEditPage(oldArchiveName, '#REDIRECT [[' + newArchiveName + ']]', 'Redirecting old archive to new archive',
        false, spiHelperSettings.watchArchive, spiHelperSettings.watchArchiveExpiry)
    }
    // Now to protect both the oldPageName and newPageName with the protection settings in newProtectionDict, unless it is empty (i.e. no protection needed)
    // Also apply any pending changes needed (i.e. if newStabilisationSettings has a non-empty protection_level)
    if (newProtectionValues.length !== 0) {
      spiHelperProtectPage(spiHelperPageName, newProtectionValues)
      spiHelperProtectPage(oldPageName, newProtectionValues)
    }
    if (newStabilisationSettings.protection_level !== '') {
      spiHelperConfigurePendingChanges(spiHelperPageName, newStabilisationSettings)
      spiHelperConfigurePendingChanges(oldPageName, newStabilisationSettings)
    }
  } else {
    await spiHelperMovePage(oldPageName, spiHelperPageName, 'Moving case to [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]', false)
  }
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
  await spiHelperPostRenameCleanup(oldPageName)
  if (targetPageText) {
    // If there was a page there before, also need to do post-merge cleanup
    await spiHelperPostMergeCleanup(targetPageText)
  }
  if (archivesCopied) {
    alert('Archives were merged during the case move, please reorder the archive sections')
  }
}

/**
 * Move or merge a specific section of a case into a different case
 *
 * @param {string} target The username portion of the case this section should be merged into (pre-normalized)
 * @param {!number} sectionId The section ID of this case that should be moved/merged
 */
async function spiHelperMoveCaseSection (target, sectionId) {
  // Move or merge a particular section of a case
  'use strict'
  const newPageName = spiHelperPageName.replace(spiHelperCaseName, target)
  let targetPageText = await spiHelperGetPageText(newPageName, false)
  let sectionText = await spiHelperGetPageText(spiHelperPageName, true, sectionId)
  // SOCK_SECTION_RE_WITH_NEWLINE cleans up extraneous whitespace at the top of the section
  // Have to do this transform before concatenating with targetPageText so that the
  // "originally filed" goes in the correct section
  sectionText = sectionText.replace(spiHelperSockSectionWithNewlineRegex, '====Suspected sockpuppets====' +
  '\n* {{checkuser|1=' + spiHelperCaseName + '}} ({{clerknote}} originally filed under this user)\n')

  if (targetPageText === '') {
    // Pre-load the split target with the SPI templates if it's empty
    targetPageText = '<noinclude>__TOC__</noinclude>\n{{SPIarchive notice|' + target + '}}\n{{SPIpriorcases}}'
  }
  targetPageText += '\n' + sectionText

  // Intentionally not async - doesn't matter when this edit finishes
  spiHelperEditPage(newPageName, targetPageText, 'Moving case section from [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']], see page history for attribution',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
  // Blank the section we moved
  await spiHelperEditPage(spiHelperPageName, '', 'Moving case section to [[' + spiHelperGetInterwikiPrefix() + newPageName + ']]',
    false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry, spiHelperStartingRevID, sectionId)
  // Update to the latest revision ID
  spiHelperStartingRevID = await spiHelperGetPageRev(spiHelperPageName)
}

/**
 * Render a text box's contents and display it in the preview area
 *
 */
