// Blocking and tagging action functions for spihelper
// This module handles user blocking and sockpuppet tagging operations

async function spiHelperTagUser (tagEntry, tagNonLocalAccounts, sockmaster, altmaster) {
  if (mw.util.isIPAddress(tagEntry.username, true)) {
    return false // do not support tagging IPs
  }
  const existsGlobally = await spiHelperDoesUserExistGlobally(tagEntry.username)
  const existsLocally = await spiHelperDoesUserExistLocally(tagEntry.username)
  if (!existsGlobally && !existsLocally) {
    // Skip, don't tag accounts that don't exist
    const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
    $statusLine.addClass('spihelper-errortext').html('<b>The account ' + tagEntry.username + ' does not exist and so has not been tagged.</b>')
    return false
  }
  if (!tagNonLocalAccounts && existsGlobally && !existsLocally) {
    // Skip as the account does not exist locally and the "tag accounts that exist locally" setting is unchecked.
    return false
  }

  let tagText = ''
  let altmasterName = ''
  let altmasterTag = ''
  if (altmaster !== '' && tagEntry.altmasterTag !== '') {
    altmasterName = altmaster
    altmasterTag = tagEntry.altmasterTag
  }
  let isMaster = false
  let tag = ''
  let checked = ''
  switch (tagEntry.tag) {
    case 'master':
      tag = 'blocked'
      isMaster = true
      break
    case 'sockmasterchecked':
      tag = 'blocked'
      checked = 'yes'
      isMaster = true
      break
    case 'bannedmaster':
      tag = 'banned'
      checked = 'yes'
      isMaster = true
      break
    default:
      tag = tagEntry.tag
  }

  const isLocked = await spiHelperIsUserGloballyLocked(tagEntry.username) ? 'yes' : 'no'
  const isNotBlocked = !existsLocally || !(await spiHelperGetUserBlockReason(tagEntry.username))

  if (isMaster) {
    // Not doing SPI or LTA fields for now - those auto-detect right now
    // and I'm not sure if setting them to empty would mess that up
    tagText += `{{sockpuppeteer
| 1 = ${tag}
| checked = ${checked}
| locked = ${isLocked}
}}`
  }
  // Not if-else because we tag something as both sock and master if they're a
  // sockmaster and have a suspected altmaster
  if (!isMaster || altmasterName) {
    let sockmasterName = sockmaster
    if (altmasterName && isMaster) {
      // If we have an altmaster and we're the master, swap a few values around
      sockmasterName = altmasterName
      tag = altmasterTag === 'suspected' ? 'blocked' : altmasterTag
      altmasterName = ''
      altmasterTag = ''
      tagText += '\n'
    }
    tagText += `{{sockpuppet
| 1 = ${sockmasterName}
| 2 = ${tag}
| locked = ${isLocked}
| notblocked = ${isNotBlocked ? 'yes' : 'no'}
| altmaster = ${altmasterName}
| altmaster-status = ${altmasterTag}
}}`
  }
  spiHelperEditPage('User:' + tagEntry.username, tagText, 'Adding sockpuppetry tag per [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]',
    false, spiHelperSettings.watchTaggedUser, spiHelperSettings.watchTaggedUserExpiry)
  return true
}

/**
 * Given a block entry, runs the required logic and blocks the user
 *
 * @param {BlockEntry} blockEntry Block entry to run the logic for
 * @param {boolean} cuBlock Whether to use the {{checkuserblock}} template family
 * @param {boolean} cuBlockOnly Whether to use just {{checkuserblock}} without an additional summary
 * @param {boolean} overrideExisting Whether any existing blocks should be overriden
 * @param {boolean} blankTalk Whether the user's talk page should be blanked before adding the block template
 * @param {string} sockmaster Username of the sockmaster
 * @return {Promise<boolean>} Whether the block succeeded
 */
async function spiHelperBlockUser (blockEntry, cuBlock, cuBlockOnly, overrideExisting, blankTalk, sockmaster) {
  const blockReason = await spiHelperGetUserBlockReason(blockEntry.username)
  if (!spiHelperIsCheckuser() && overrideExisting &&
    spiHelperCUBlockRegex.exec(blockReason)) {
    // If you're not a checkuser, we've asked to overwrite existing blocks, and the block
    // target has a CU block on them, check whether that was intended
    if (!confirm('User ' + blockEntry.username + ' appears to be CheckUser-blocked, are you SURE you want to re-block them?\n' +
      'Current block message:\n' + blockReason
    )) {
      return false
    }
  }
  const isIP = mw.util.isIPAddress(blockEntry.username, true)
  const isIPRange = isIP && !mw.util.isIPAddress(blockEntry.username, false)
  let blockSummary = 'Abusing [[WP:SOCK|multiple accounts]]: Please see: [[' + spiHelperInterwikiPrefix + spiHelperPageName + ']]'
  if (spiHelperIsCheckuser() && cuBlock) {
    const cublockTemplate = isIP ? ('{{checkuserblock}}') : ('{{checkuserblock-account}}')
    if (cuBlockOnly) {
      blockSummary = cublockTemplate
    } else {
      blockSummary = cublockTemplate + ': ' + blockSummary
    }
  } else if (isIPRange) {
    blockSummary = '{{rangeblock|1= ' + blockSummary +
      (blockEntry.acb ? '' : '|create=yes') + '}}'
  }
  const blockSuccess = await spiHelperWikiBlockUser(
    blockEntry.username,
    blockEntry.duration,
    blockSummary,
    overrideExisting,
    (isIP ? blockEntry.ab : false),
    blockEntry.acb,
    (isIP ? false : blockEntry.ab),
    blockEntry.ntp,
    blockEntry.nem,
    spiHelperSettings.watchBlockedUser,
    spiHelperSettings.watchBlockedUserExpiry)
  if (!blockSuccess) {
    // Don't add a block notice if we failed to block
    if (blockEntry.tpn) {
      // Also warn the user if we were going to post a block notice on their talk page
      const $statusLine = $('<li>').appendTo($('#spiHelper_status', document))
      $statusLine.addClass('spihelper-errortext').html('<b>Block failed on ' + blockEntry.username + ', not adding talk page notice</b>')
    }
    return false
  }

  if (isIPRange) {
    // There isn't really a talk page for an IP range, so return here before we reach that section
    return blockSuccess
  }
  // Talk page notice
  if (blockEntry.tpn) {
    let newText = ''
    let isSock = blockEntry.tpn.includes('sock')
    // Hacky workaround for when we didn't make a master tag
    if (isSock && blockEntry.username === spiHelperNormalizeUsername(sockmaster)) {
      isSock = false
    }
    if (isSock) {
      newText = '== Blocked as a sockpuppet ==\n'
    } else {
      newText = '== Blocked for sockpuppetry ==\n'
    }
    const isCheckUserBlockAccount = spiHelperIsCheckuser() && cuBlock && spiHelperSettings.useCheckuserblockAccount
    if (isCheckUserBlockAccount) {
      newText += '{{checkuserblock-account|sig=~~~~'
    } else {
      newText += '{{subst:uw-sockblock|sig=yes'
    }
    newText += '|spi=' + spiHelperCaseName
    if (blockEntry.duration === 'indefinite' || blockEntry.duration === 'infinity') {
      newText += '|indef=yes'
    } else {
      newText += '|time=' + blockEntry.duration
      if (isCheckUserBlockAccount) {
        newText += '|indef=no'
      }
    }
    if (blockEntry.ntp) {
      newText += '|notalk=yes'
    }
    if (isSock) {
      newText += '|master=' + sockmaster
    }
    newText += '}}'

    if (!blankTalk) {
      const oldtext = await spiHelperGetPageText('User talk:' + blockEntry.username, true)
      if (oldtext !== '') {
        newText = oldtext + '\n' + newText
      }
    }
    // Hardcode the watch setting to 'nochange' since we will have either watched or not watched based on the _boolean_
    // watchBlockedUser
    spiHelperEditPage('User talk:' + blockEntry.username,
      newText, 'Adding sockpuppetry block notice per [[' + spiHelperGetInterwikiPrefix() + spiHelperPageName + ']]', false, 'nochange')
  }

  return true
}

/**
 * Goes through the action selections and executes them meaty
 */
