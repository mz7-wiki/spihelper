// UI and form generation functions for spihelper
// This module handles all UI rendering and form interactions

async function spiHelperInit () {
  'use strict'
  spiHelperCaseSections = await spiHelperGetInvestigationSectionIDs()

  // Load archivenotice params
  spiHelperArchiveNoticeParams = await spiHelperParseArchiveNotice(spiHelperPageName.replace(/\/Archive/, ''))

  // First, insert the template text
  displayMessage(spiHelperTopViewHTML)

  // Narrow search scope
  const $topView = $('#spiHelper_topViewDiv', document)
  updateForRole($topView)

  if (spiHelperArchiveNoticeParams.username === null) {
    // No archive notice was found
    const $warningText = $('#spiHelper_warning', $topView)
    $warningText.show()
    $warningText.append($('<b>').text('Can\'t find archivenotice template! Automatically adding the archive notice to the page.'))
    const newArchiveNotice = spiHelperMakeNewArchiveNotice(spiHelperCaseName, { xwiki: false, deny: false, notalk: false })
    let pagetext = await spiHelperGetPageText(spiHelperPageName, false)
    if (spiHelperPriorCasesRegex.exec(pagetext) === null) {
      pagetext = '{{SPIpriorcases}}\n' + pagetext
    }
    pagetext = newArchiveNotice + '\n' + pagetext
    if (pagetext.indexOf('__TOC__') === -1) {
      pagetext = '<noinclude>__TOC__</noinclude>\n' + pagetext
    }
    await spiHelperEditPage(spiHelperPageName, pagetext, 'Adding archive notice', false, spiHelperSettings.watchCase, spiHelperSettings.watchCaseExpiry)
  }

  // Next, modify what's displayed
  // Set the block selection label based on whether or not the user is an admin
  $('#spiHelper_blockLabel', $topView).text(spiHelperIsAdmin() ? 'Block/tag socks' : 'Tag socks')

  // Wire up a couple of onclick handlers
  $('#spiHelper_Move', $topView).on('click', function () {
    spiHelperUpdateArchive()
  })
  $('#spiHelper_Archive', $topView).on('click', function () {
    spiHelperUpdateMove()
  })

  // Generate the section selector
  const $sectionSelect = $('#spiHelper_sectionSelect', $topView)
  $sectionSelect.on('change', () => {
    spiHelperSetCheckboxesBySection()
  })

  // Add the dates to the selector
  for (let i = 0; i < spiHelperCaseSections.length; i++) {
    const s = spiHelperCaseSections[i]
    $('<option>').val(s.index).text(s.line).appendTo($sectionSelect)
  }
  // All-sections selector...deliberately at the bottom, the default should be the first section
  $('<option>').val('all').text('All Sections').appendTo($sectionSelect)

  // Only show options suitable for the archive subpage when running on the archives
  if (!spiHelperIsThisPageAnArchive) {
    $('.spiHelper_notOnArchive', $topView).show()
  }
  // Set the checkboxes to their default states
  spiHelperSetCheckboxesBySection()

  $('#spiHelper_GenerateForm', $topView).one('click', () => {
    spiHelperGenerateForm()
  })
}

/**
 * Big function to generate the SPI form from the top-level menu selections
 *
 * Would fail ESlint no-unused-vars due to only being
 * referenced in an onclick event
 *
 * @return {Promise<void>}
 */
// eslint-disable-next-line no-unused-vars
async function spiHelperGenerateForm () {
  'use strict'
  spiHelperBlockTableUserCount = 0
  spiHelperLinkTableUserCount = 0
  const $topView = $('#spiHelper_topViewDiv', document)
  spiHelperActionsSelected.Case_act = $('#spiHelper_Case_Action', $topView).prop('checked')
  spiHelperActionsSelected.Block = $('#spiHelper_BlockTag', $topView).prop('checked')
  spiHelperActionsSelected.Link = $('#spiHelper_userInfo', $topView).prop('checked')
  spiHelperActionsSelected.Close = $('#spiHelper_Close', $topView).prop('checked')
  spiHelperActionsSelected.Note = $('#spiHelper_Comment', $topView).prop('checked') || spiHelperActionsSelected.Case_act || spiHelperActionsSelected.Block || spiHelperActionsSelected.Close
  spiHelperActionsSelected.Rename = $('#spiHelper_Move', $topView).prop('checked')
  spiHelperActionsSelected.Archive = $('#spiHelper_Archive', $topView).prop('checked')
  spiHelperActionsSelected.SpiMgmt = $('#spiHelper_SpiMgmt', $topView).prop('checked')
  const pagetext = await spiHelperGetPageText(spiHelperPageName, false, spiHelperSectionId)
  if (!(spiHelperActionsSelected.Case_act ||
    spiHelperActionsSelected.Note || spiHelperActionsSelected.Close ||
    spiHelperActionsSelected.Archive || spiHelperActionsSelected.Block || spiHelperActionsSelected.Link ||
    spiHelperActionsSelected.Rename || spiHelperActionsSelected.SpiMgmt)) {
    displayMessage('')
    return
  }

  displayMessage(spiHelperActionViewHTML)

  // Reduce the scope that jquery operates on
  const $actionView = $('#spiHelper_actionViewDiv', document)
  updateForRole($actionView)

  // Wire up the action view
  $('#spiHelper_backLink', $actionView).one('click', () => {
    spiHelperInit()
  })
  if (spiHelperActionsSelected.Case_act) {
    const result = spiHelperCaseStatusRegex.exec(pagetext)
    let casestatus = ''
    if (result) {
      casestatus = result[1]
    }
    const canAddCURequest = (casestatus === '' || /^(?:admin|moreinfo|cumoreinfo|hold|cuhold|clerk|open)$/i.test(casestatus))
    const cuRequested = /^(?:CU|checkuser|CUrequest|request|cumoreinfo)$/i.test(casestatus)
    const cuEndorsed = /^(?:endorse(d)?)$/i.test(casestatus)
    const cuCompleted = /^(?:inprogress|checking|relist(ed)?|checked|completed|declined?|cudeclin(ed)?)$/i.test(casestatus)

    /** @type {SelectOption[]} Generated array of values for the case status select box */
    const selectOpts = [
      { label: 'No action', value: 'noaction', selected: true }
    ]
    if (spiHelperCaseClosedRegex.test(casestatus)) {
      selectOpts.push({ label: 'Reopen', value: 'reopen', selected: false })
    } else if (spiHelperIsClerk() && casestatus === 'clerk') {
      // Allow clerks to change the status from clerk to open.
      // Used when clerk assistance has been given and the case previously had the status 'open'.
      selectOpts.push({ label: 'Mark as open', value: 'open', selected: false })
    } else if (spiHelperIsAdmin() && casestatus === 'admin') {
      // Allow admins to change the status to open from admin
      // Used when admin assistance has been given to the non-admin clerk and the case previously had the status 'open'.
      selectOpts.push({ label: 'Mark as open', value: 'open', selected: false })
    }
    if (spiHelperIsCheckuser()) {
      selectOpts.push({ label: 'Mark as in progress', value: 'inprogress', selected: false })
    }
    if (spiHelperIsClerk() || spiHelperIsAdmin()) {
      selectOpts.push({ label: 'Request more information', value: 'moreinfo', selected: false })
    }
    if (canAddCURequest) {
      // Statuses only available if the case could be moved to "CU requested"
      selectOpts.push({ label: 'Request CU', value: 'CUrequest', selected: false })
      if (spiHelperIsClerk()) {
        selectOpts.push({ label: 'Request CU and self-endorse', value: 'selfendorse', selected: false })
      }
    }
    // CU already requested
    if (cuRequested && spiHelperIsClerk()) {
      // Statuses only available if CU has been requested, only clerks + CUs should use these
      selectOpts.push({ label: 'Endorse for CU attention', value: 'endorse', selected: false })
      // Switch the decline option depending on whether the user is a checkuser
      if (spiHelperIsCheckuser()) {
        selectOpts.push({ label: 'Endorse CU as a CheckUser', value: 'cuendorse', selected: false })
      }
      if (spiHelperIsCheckuser()) {
        selectOpts.push({ label: 'Decline CU', value: 'cudecline', selected: false })
      } else {
        selectOpts.push({ label: 'Decline CU', value: 'decline', selected: false })
      }
      selectOpts.push({ label: 'Request more information for CU', value: 'cumoreinfo', selected: false })
    } else if (cuEndorsed && spiHelperIsCheckuser()) {
      // Let checkusers decline endorsed cases
      if (spiHelperIsCheckuser()) {
        selectOpts.push({ label: 'Decline CU', value: 'cudecline', selected: false })
      }
      selectOpts.push({ label: 'Request more information for CU', value: 'cumoreinfo', selected: false })
    }
    // This is mostly a CU function, but let's let clerks and admins set it
    //  in case the CU forgot (or in case we're un-closing))
    if (spiHelperIsAdmin() || spiHelperIsClerk()) {
      selectOpts.push({ label: 'Mark as checked', value: 'checked', selected: false })
    }
    if (spiHelperIsClerk() && cuCompleted) {
      selectOpts.push({ label: 'Relist for another check', value: 'relist', selected: false })
    }
    if (spiHelperIsCheckuser()) {
      selectOpts.push({ label: 'Place case on CU hold', value: 'cuhold', selected: false })
    } else { // I guess it's okay for anyone to have this option
      selectOpts.push({ label: 'Place case on hold', value: 'hold', selected: false })
    }
    selectOpts.push({ label: 'Request clerk action', value: 'clerk', selected: false })
    // I think this is only useful for non-admin clerks to ask admins to do stuff
    if (!spiHelperIsAdmin() && spiHelperIsClerk()) {
      selectOpts.push({ label: 'Request admin action', value: 'admin', selected: false })
    }
    // Generate the case action options
    spiHelperGenerateSelect('spiHelper_CaseAction', selectOpts)
    // Add the onclick handler to the drop-down
    $('#spiHelper_CaseAction', $actionView).on('change', function (e) {
      spiHelperCaseActionUpdated($(e.target))
    })

    $('#spiHelper_actionView', $actionView).show()
  }

  if (spiHelperActionsSelected.SpiMgmt) {
    const $xwikiBox = $('#spiHelper_spiMgmt_crosswiki', $actionView)
    const $denyBox = $('#spiHelper_spiMgmt_deny', $actionView)
    const $notalkBox = $('#spiHelper_spiMgmt_notalk', $actionView)

    $xwikiBox.prop('checked', spiHelperArchiveNoticeParams.xwiki)
    $denyBox.prop('checked', spiHelperArchiveNoticeParams.deny)
    $notalkBox.prop('checked', spiHelperArchiveNoticeParams.notalk)

    $('#spiHelper_spiMgmtView', $actionView).show()
  }

  if (spiHelperActionsSelected.Close) {
    $('#spiHelper_closeView', $actionView).show()
  }
  if (spiHelperActionsSelected.Archive) {
    $('#spiHelper_archiveView', $actionView).show()
  }
  // Only give the option to comment if we selected a specific section and we are not running on an archive subpage
  if (spiHelperSectionId && spiHelperActionsSelected.Note && !spiHelperIsThisPageAnArchive) {
    // generate the note prefixes
    /** @type {SelectOption[]} */
    const spiHelperNoteTemplates = [
      { label: 'Comment templates', selected: true, value: '', disabled: true }
    ]
    if (spiHelperIsClerk()) {
      spiHelperNoteTemplates.push({ label: 'Clerk note', selected: false, value: 'clerknote' })
    }
    if (spiHelperIsAdmin()) {
      spiHelperNoteTemplates.push({ label: 'Administrator note', selected: false, value: 'adminnote' })
    }
    if (spiHelperIsCheckuser()) {
      spiHelperNoteTemplates.push({ label: 'CU note', selected: false, value: 'cunote' })
    }
    spiHelperNoteTemplates.push({ label: 'Note', selected: false, value: 'takenote' })

    // Wire up the select boxes
    spiHelperGenerateSelect('spiHelper_noteSelect', spiHelperNoteTemplates)
    $('#spiHelper_noteSelect', $actionView).on('change', function (e) {
      spiHelperInsertNote($(e.target))
    })
    spiHelperGenerateSelect('spiHelper_adminSelect', spiHelperAdminTemplates)
    $('#spiHelper_adminSelect', $actionView).on('change', function (e) {
      spiHelperInsertTextFromSelect($(e.target))
    })
    spiHelperGenerateSelect('spiHelper_cuSelect', spiHelperCUTemplates)
    $('#spiHelper_cuSelect', $actionView).on('change', function (e) {
      spiHelperInsertTextFromSelect($(e.target))
    })
    $('#spiHelper_previewLink', $actionView).on('click', function () {
      spiHelperPreviewText()
    })
    $('#spiHelper_commentView', $actionView).show()
  }
  if (spiHelperActionsSelected.Rename) {
    if (spiHelperSectionId) {
      $('#spiHelper_moveHeader', $actionView).text('Move section "' + spiHelperSectionName + '"')
    } else {
      $('#spiHelper_moveHeader', $actionView).text('Move/merge full case')
    }
    $('#spiHelper_moveView', $actionView).show()
  }
  if (spiHelperActionsSelected.Block || spiHelperActionsSelected.Link) {
    // eslint-disable-next-line no-useless-escape
    
    const checkuserRegex = /{{\s*check(?:user|ip)\s*\|\s*(?:1=)?\s*([^\|}]*?)\s*(?:\|master name\s*=\s*.*)?}}/gi
    const results = pagetext.match(checkuserRegex)
    const likelyusers = []
    const likelyips = []
    const possibleusers = []
    const possibleips = []
    likelyusers.push(spiHelperCaseName)    

    
    let socklist = $(`a[href$="section=${spiHelperSectionId}"]`).parents().not(':has(hr)').nextUntil('hr').find('.cuEntry').find('a:first')
    for(let element of socklist) {
      let username = spiHelperNormalizeUsername($(element).text())
      const isIP = mw.util.isIPAddress(username, true)
        if (!isIP && !likelyusers.includes(username)) {
          likelyusers.push(username)
        } else if (isIP && !likelyips.includes(username)) {
          if (spiHelperSettings.displayIPv6As64 && mw.util.isIPv6Address(username, false)) {
            likelyips.push(username.split(':').slice(0, 4).concat('0', '0', '0', '0').join(':') + '/64')
            continue
          }
          likelyips.push(username)
        }
    }
    

    // eslint-disable-next-line no-useless-escape
    const userRegex = /{{[^\|}{]*?(?:user|vandal|IP|noping)[^\|}{]*?\|\s*(?:1=)?\s*([^\|}]*?)\s*}}/gi
    const userresults = pagetext.match(userRegex)
    if (userresults) {
      for (let i = 0; i < userresults.length; i++) {
        const username = spiHelperNormalizeUsername(userresults[i].replace(userRegex, '$1'))
        const isIP = mw.util.isIPAddress(username, true)
        if (isIP && !possibleips.includes(username) &&
          !likelyips.includes(username)) {
          possibleips.push(username)
        } else if (!isIP && !possibleusers.includes(username) &&
          !likelyusers.includes(username)) {
          possibleusers.push(username)
        }
      }
    }
    if (spiHelperActionsSelected.Block) {
      // Show generation in progress so not to make people think its broken
      $('#spiHelper_blockTagView', $actionView).show()
      if (spiHelperIsAdmin()) {
        $('#spiHelper_blockTagHeader', $actionView).text('Blocking and tagging socks')
      } else {
        $('#spiHelper_blockTagHeader', $actionView).text('Tagging socks')
      }
      // Wire up the "select all" options
      $('#spiHelper_block_doblock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_acb', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_ab', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_tp', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_email', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_lock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_lock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      spiHelperGenerateSelect('spiHelper_block_tag', spiHelperTagOptions)
      $('#spiHelper_block_tag', $actionView).on('change', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      spiHelperGenerateSelect('spiHelper_block_tag_altmaster', spiHelperAltMasterTagOptions)
      $('#spiHelper_block_tag_altmaster', $actionView).on('change', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })
      $('#spiHelper_block_lock', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'block')
      })

      for (let i = 0; i < likelyusers.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(likelyusers[i], true, spiHelperBlockTableUserCount)
      }
      for (let i = 0; i < likelyips.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(likelyips[i], true, spiHelperBlockTableUserCount)
      }
      for (let i = 0; i < possibleusers.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(possibleusers[i], false, spiHelperBlockTableUserCount)
      }
      for (let i = 0; i < possibleips.length; i++) {
        spiHelperBlockTableUserCount++
        await spiHelperGenerateBlockTableLine(possibleips[i], false, spiHelperBlockTableUserCount)
      }
    }
    if (spiHelperActionsSelected.Link) {
      // Wire up the "select all" options
      $('#spiHelper_link_editorInteractionAnalyser', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_interactionTimeline', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_timecardSPITools', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_consolidatedTimelineSPITools', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_pagesSPITools', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })
      $('#spiHelper_link_checkUserWikiSearch', $actionView).on('click', function (e) {
        spiHelperSetAllTableColumnOpts($(e.target), 'link')
      })

      for (let i = 0; i < likelyusers.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(likelyusers[i], spiHelperLinkTableUserCount)
      }
      for (let i = 0; i < likelyips.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(likelyips[i], spiHelperLinkTableUserCount)
      }
      for (let i = 0; i < possibleusers.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(possibleusers[i], spiHelperLinkTableUserCount)
      }
      for (let i = 0; i < possibleips.length; i++) {
        spiHelperLinkTableUserCount++
        await spiHelperGenerateLinksTableLine(possibleips[i], spiHelperLinkTableUserCount)
      }
      $('#spiHelper_sockLinksView', $actionView).show()
    }
    $('#spiHelper_blockTagView', $actionView).show()
  }
  // Wire up the submit button
  $('#spiHelper_performActions', $actionView).one('click', () => {
    spiHelperPerformActions()
  })
}

/**
 * Update the view for the roles of the person running the script
 * by selectively hiding.
 * view: @type JQuery object representing the class / id for the view
 */
async function updateForRole (view) {
  // Hide items based on role
  if (!spiHelperIsCheckuser()) {
    // Hide CU options from non-CUs
    $('.spiHelper_cuClass', view).hide()
  }
  if (!spiHelperIsAdmin()) {
    // Hide block options from non-admins
    $('.spiHelper_adminClass', view).hide()
  }
  if (!(spiHelperIsAdmin() || spiHelperIsClerk())) {
    $('.spiHelper_adminClerkClass', view).hide()
  }
}

/**
 * Archives everything on the page that's eligible for archiving
 */

async function spiHelperPreviewText () {
  const inputText = $('#spiHelper_CommentText', document).val().toString()
  const renderedText = await spiHelperRenderText(spiHelperPageName, inputText)
  // Fill the preview box with the new text
  const $previewBox = $('#spiHelper_previewBox', document)
  $previewBox.html(renderedText)
  // Unhide it if it was hidden
  $previewBox.show()
}

/**
 * Given a page title, get an API to operate on that page
 *
 * @param {string} title Title of the page we want the API for
 * @return {Object} MediaWiki Api/ForeignAPI for the target page's wiki
 */

async function spiHelperGenerateBlockTableLine (name, defaultblock, id) {
  'use strict'

  let currentBlock = null
  if (name) {
    currentBlock = await spiHelperGetUserBlockSettings(name)
  }

  let block, ab, acb, ntp, nem, duration

  if (currentBlock) {
    block = true
    acb = currentBlock.acb
    ab = currentBlock.ab
    ntp = currentBlock.ntp
    nem = currentBlock.nem
    duration = currentBlock.duration
  } else {
    block = defaultblock
    acb = true
    ab = true
    ntp = spiHelperArchiveNoticeParams.notalk
    nem = spiHelperArchiveNoticeParams.notalk
    duration = mw.util.isIPAddress(name, true) ? '1 week' : 'indefinite'
  }

  const $table = $('#spiHelper_blockTable', document)

  const $row = $('<tr>')
  // Username
  $('<td>').append($('<input>').attr('type', 'text').attr('id', 'spiHelper_block_username' + id)
    .val(name).addClass('.spihelper-widthlimit')).appendTo($row)
  // Block checkbox (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_doblock' + id).prop('checked', block)).appendTo($row)
  // Block duration (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'text')
    .attr('id', 'spiHelper_block_duration' + id).val(duration)
    .addClass('.spihelper-widthlimit')).appendTo($row)
  // Account creation blocked (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_acb' + id).prop('checked', acb)).appendTo($row)
  // Autoblock (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_ab' + id).prop('checked', ab)).appendTo($row)
  // Revoke talk page access (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_tp' + id).prop('checked', ntp)).appendTo($row)
  // Block email access (only for admins)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_block_email' + id).prop('checked', nem)).appendTo($row)
  // Tag select box
  $('<td>').append($('<select>').attr('id', 'spiHelper_block_tag' + id)
    .val(name)).appendTo($row)
  // Altmaster tag select
  $('<td>').append($('<select>').attr('id', 'spiHelper_block_tag_altmaster' + id)
    .val(name)).appendTo($row)
  // Global lock (disabled for IPs since they can't be locked)
  $('<td>').append($('<input>').attr('type', 'checkbox').attr('id', 'spiHelper_block_lock' + id)
    .prop('disabled', mw.util.isIPAddress(name, true))).appendTo($row)
  $table.append($row)

  // Generate the select entries
  spiHelperGenerateSelect('spiHelper_block_tag' + id, spiHelperTagOptions)
  spiHelperGenerateSelect('spiHelper_block_tag_altmaster' + id, spiHelperAltMasterTagOptions)

  // Add onlistener events to update the global lock checkbox if the username is changed between a IP address and username
  $('#spiHelper_block_username' + id).on('change', (event) => {
    const id = $(event.target).attr('id').replace('spiHelper_block_username', '')
    $('#spiHelper_block_lock' + id).prop('disabled', mw.util.isIPAddress($(event.target).val(), true))
  })
}

async function spiHelperGenerateLinksTableLine (username, id) {
  'use strict'

  const $table = $('#spiHelper_userInfoTable', document)

  const $row = $('<tr>')
  // Username
  $('<td>').append($('<input>').attr('type', 'text').attr('id', 'spiHelper_link_username' + id)
    .val(username).addClass('.spihelper-widthlimit')).appendTo($row)
  // Editor interaction analyser
  $('<td>').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_editorInteractionAnalyser' + id)).attr('style', 'text-align:center;').appendTo($row)
  // Interaction timeline
  $('<td>').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_interactionTimeline' + id)).attr('style', 'text-align:center;').appendTo($row)
  // SPI tools timecard tool
  $('<td>').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_timecardSPITools' + id)).attr('style', 'text-align:center;').appendTo($row)
  // SPI tools consilidated timeline (admin only based on OAUTH requirements)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_consolidatedTimelineSPITools' + id)).attr('style', 'text-align:center;').appendTo($row)
  // SPI tools pages tool (admin only based on OAUTH requirements)
  $('<td>').addClass('spiHelper_adminClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_pagesSPITools' + id)).attr('style', 'text-align:center;').appendTo($row)
  // Checkuser wiki search (CU only)
  $('<td>').addClass('spiHelper_cuClass').append($('<input>').attr('type', 'checkbox')
    .attr('id', 'spiHelper_link_checkUserWikiSearch' + id)).attr('style', 'text-align:center;').appendTo($row)
  $table.append($row)
}

/**
 * Complicated function to decide what checkboxes to enable or disable
 * and which to check by default
 */
async function spiHelperSetCheckboxesBySection () {
  // Displays the top-level SPI menu
  'use strict'

  const $topView = $('#spiHelper_topViewDiv', document)
  // Get the value of the selection box
  if ($('#spiHelper_sectionSelect', $topView).val() === 'all') {
    spiHelperSectionId = null
    spiHelperSectionName = null
  } else {
    spiHelperSectionId = parseInt($('#spiHelper_sectionSelect', $topView).val().toString())
    const $sectionSelect = $('#spiHelper_sectionSelect', $topView)
    spiHelperSectionName = spiHelperCaseSections[$sectionSelect.prop('selectedIndex')].line
  }

  const $warningText = $('#spiHelper_warning', $topView)
  $warningText.hide()

  const $archiveBox = $('#spiHelper_Archive', $topView)
  const $closeBox = $('#spiHelper_Close', $topView)
  const $moveBox = $('#spiHelper_Move', $topView)
  /*
  const $blockBox = $('#spiHelper_BlockTag', $topView)
  const $commentBox = $('#spiHelper_Comment', $topView)
  const $caseActionBox = $('#spiHelper_Case_Action', $topView)
  const $spiMgmtBox = $('#spiHelper_SpiMgmt', $topView)

  // Start by unchecking everything
  $archiveBox.prop('checked', false)
  $blockBox.prop('checked', false)
  $closeBox.prop('checked', false)
  $commentBox.prop('checked', false)
  $moveBox.prop('checked', false)
  $caseActionBox.prop('checked', false)
  $spiMgmtBox.prop('checked', false)
  */

  // Enable optionally-disabled boxes
  $closeBox.prop('disabled', false)
  $archiveBox.prop('disabled', false)

  // archivenotice sanity check
  const pageText = await spiHelperGetPageText(spiHelperPageName, false)

  const result = spiHelperArchiveNoticeRegex.exec(pageText)
  if (!result) {
    $warningText.append($('<b>').text('Can\'t find archivenotice template!'))
    $warningText.show()
  }

  if (spiHelperSectionId === null) {
    // Hide inputs that aren't relevant in the case view
    $('.spiHelper_singleCaseOnly', $topView).hide()
    // Show inputs only visible in all-case mode
    $('.spiHelper_allCasesOnly', $topView).show()
    // Fix the move label
    $('#spiHelper_moveLabel', $topView).text('Move/merge full case (Clerk only)')
    // enable the move box
    $moveBox.prop('disabled', false)
  } else {
    const sectionText = await spiHelperGetPageText(spiHelperPageName, false, spiHelperSectionId)
    if (!spiHelperSectionRegex.test(sectionText)) {
      // Nothing to do here.
      return
    }

    // Unhide single-case options
    $('.spiHelper_singleCaseOnly', $topView).show()
    // Hide inputs only visible in all-case mode
    $('.spiHelper_allCasesOnly', $topView).hide()

    const result = spiHelperCaseStatusRegex.exec(sectionText)
    let casestatus = ''
    if (result) {
      casestatus = result[1]
    } else if (!spiHelperIsThisPageAnArchive) {
      $warningText.append($('<b>').text(`Can't find case status in ${spiHelperSectionName}!`))
      $warningText.show()
    }

    // Disable the section move setting if you haven't opted into it
    if (!spiHelperSettings.iUnderstandSectionMoves) {
      $moveBox.prop('disabled', true)
      $moveBox.prop('checked', false)
    }

    const isClosed = spiHelperCaseClosedRegex.test(casestatus)

    if (isClosed) {
      $closeBox.prop('disabled', true)
      $closeBox.prop('checked', false)
      if (spiHelperSettings.tickArchiveWhenCaseClosed) {
        $archiveBox.prop('checked', true)
      }
    } else {
      $archiveBox.prop('disabled', true)
      $archiveBox.prop('checked', false)
      $('#spiHelper_Case_Action', $topView).on('click', function () {
        $('#spiHelper_Close', $topView).prop('disabled', $('#spiHelper_Case_Action', $topView).prop('checked'))
      })
      $('#spiHelper_Close', $topView).on('click', function () {
        $('#spiHelper_Case_Action', $topView).prop('disabled', $('#spiHelper_Close', $topView).prop('checked'))
      })
    }

    // Change the label on the rename button
    $('#spiHelper_moveLabel', $topView).html('Move case section (<span title="You probably want to move the full case, ' +
      'select All Sections instead of a specific date in the drop-down"' +
      'class="rt-commentedText spihelper-hovertext"><b>READ ME FIRST</b></span>)')
  }
  // Only show options suitable for the archive subpage when running on the archives
  if (spiHelperIsThisPageAnArchive) {
    $('.spiHelper_notOnArchive', $topView).hide()
  }
}

/**
 * Updates whether the 'archive' checkbox is enabled
 */
function spiHelperUpdateArchive () {
  // Archive should only be an option if close is checked or disabled (disabled meaning that
  // the case is closed) and rename is not checked
  'use strict'
  $('#spiHelper_Archive', document).prop('disabled', !($('#spiHelper_Close', document).prop('checked') ||
    $('#spiHelper_Close', document).prop('disabled')) || $('#spiHelper_Move', document).prop('checked'))
  if ($('#spiHelper_Archive', document).prop('disabled')) {
    $('#spiHelper_Archive', document).prop('checked', false)
  }
}

/**
 * Updates whether the 'move' checkbox is enabled
 */
function spiHelperUpdateMove () {
  // Rename is mutually exclusive with archive
  'use strict'
  $('#spiHelper_Move', document).prop('disabled', $('#spiHelper_Archive', document).prop('checked'))
  if ($('#spiHelper_Move', document).prop('disabled')) {
    $('#spiHelper_Move', document).prop('checked', false)
  }
}

/**
 * Generate a select input, optionally with an onChange call
 *
 * @param {string} id Name of the input
 * @param {SelectOption[]} options Array of options objects
 */
function spiHelperGenerateSelect (id, options) {
  // Add the dates to the selector
  const $selector = $('#' + id, document)
  for (let i = 0; i < options.length; i++) {
    const o = options[i]
    $('<option>')
      .val(o.value)
      .prop('selected', o.selected)
      .text(o.label)
      .prop('disabled', o.disabled)
      .appendTo($selector)
  }
}

/**
 * Given an HTML element, sets that element's value on all block options
 * For example, checking the 'block all' button will check all per-user 'block' elements
 *
 * @param {JQuery<HTMLElement>} source The HTML input element that we're matching all selections to
 */
function spiHelperSetAllTableColumnOpts (source, forTable) {
  'use strict'
  for (let i = 1; i <= (forTable === 'link' ? spiHelperLinkTableUserCount : spiHelperBlockTableUserCount); i++) {
    const $target = $('#' + source.attr('id') + i)
    if (source.attr('type') === 'checkbox') {
      // Don't try to set disabled checkboxes
      if (!$target.prop('disabled')) {
        $target.prop('checked', source.prop('checked'))
      }
    } else {
      $target.val(source.val())
    }
  }
}

/**
 * Inserts text at the cursor's position
 *
 * @param {JQuery<HTMLElement>} source Select box that was changed
 * @param {number?} pos Position to insert text; if null, inserts at the cursor
 */
function spiHelperInsertTextFromSelect (source, pos = null) {
  const $textBox = $('#spiHelper_CommentText', document)
  // https://stackoverflow.com/questions/11076975/how-to-insert-text-into-the-textarea-at-the-current-cursor-position
  const selectionStart = parseInt($textBox.attr('selectionStart'))
  const selectionEnd = parseInt($textBox.attr('selectionEnd'))
  const startText = $textBox.val().toString()
  const newText = source.val().toString()
  if (pos === null && (selectionStart || selectionStart === 0)) {
    $textBox.val(startText.substring(0, selectionStart) +
      newText +
      startText.substring(selectionEnd, startText.length))
    $textBox.attr('selectionStart', selectionStart + newText.length)
    $textBox.attr('selectionEnd', selectionEnd + newText.length)
  } else if (pos !== null) {
    $textBox.val(startText.substring(0, pos) +
      source.val() +
      startText.substring(pos, startText.length))
    $textBox.attr('selectionStart', selectionStart + newText.length)
    $textBox.attr('selectionEnd', selectionEnd + newText.length)
  } else {
    $textBox.val(startText + newText)
  }

  // Force the selected element to reset its selection to 0
  source.prop('selectedIndex', 0)
}

/**
 * Inserts a {{note}} template at the start of the text box
 *
 * @param {JQuery<HTMLElement>} source Select box that was changed
 */
function spiHelperInsertNote (source) {
  'use strict'
  const $textBox = $('#spiHelper_CommentText', document)
  let newText = $textBox.val().toString()
  // Match the start of the line, optionally including a '*' with or without whitespace around it,
  // optionally including a template which contains the string "note"
  newText = newText.replace(/^(\s*\*\s*)?({{[\w\s]*note[\w\s]*}}\s*)?/i, '* {{' + source.val() + '}} ')
  $textBox.val(newText)

  // Force the selected element to reset its selection to 0
  source.prop('selectedIndex', 0)
}

/**
 * Changes the case status in the comment box
 *
 * @param {JQuery<HTMLElement>} source Select box that was changed
 */
function spiHelperCaseActionUpdated (source) {
  const $textBox = $('#spiHelper_CommentText', document)
  let newText = $textBox.val().toString()
  let newTemplate = ''
  switch (source.val()) {
    case 'CUrequest':
      newTemplate = '{{CURequest}}'
      break
    case 'admin':
      newTemplate = '{{awaitingadmin}}'
      break
    case 'clerk':
      newTemplate = '{{Clerk Request}}'
      break
    case 'selfendorse':
      newTemplate = '{{Requestandendorse}}'
      break
    case 'inprogress':
      newTemplate = '{{Inprogress}}'
      break
    case 'decline':
      newTemplate = '{{Decline}}'
      break
    case 'cudecline':
      newTemplate = '{{Cudecline}}'
      break
    case 'endorse':
      newTemplate = '{{Endorse}}'
      break
    case 'cuendorse':
      newTemplate = '{{cu-endorsed}}'
      break
    case 'moreinfo': // Intentional fallthrough
    case 'cumoreinfo':
      newTemplate = '{{moreinfo}}'
      break
    case 'relist':
      newTemplate = '{{relisted}}'
      break
    case 'hold':
    case 'cuhold':
      newTemplate = '{{onhold}}'
      break
  }
  if (spiHelperClerkStatusRegex.test(newText)) {
    newText = newText.replace(spiHelperClerkStatusRegex, newTemplate)
    if (!newTemplate) { // If the new template is empty, get rid of the stray ' - '
      newText = newText.replace(/^(\s*\*\s*)? - /, '$1')
    }
  } else if (newTemplate) {
    // Don't try to insert if the "new template" is empty
    // Also remove the leading *
    newText = '*' + newTemplate + ' - ' + newText.replace(/^\s*\*\s*/, '')
  }
  $textBox.val(newText)
}

/**
 * Fires on page load, adds the SPI portlet and (if the page is categorized as "awaiting
 * archive," meaning that at least one closed template is on the page) the SPI-Archive portlet
 */
