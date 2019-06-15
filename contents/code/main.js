/*
 * KWin Quick Tile Enhancements 0.2.0
 * @thetarkus, Mike Mob
 * https://github.com/thetarkus/kwin-quick-tile-enhancements
 */


var ScreenEdge = {
  FLOATING:    -1,
  MAXIMIZED:   -1,
  LEFT:         0,
  RIGHT:        1,
  TOP_LEFT:     2,
  TOP_RIGHT:    3,
  BOTTOM_LEFT:  4,
  BOTTOM_RIGHT: 5,
};


// Tolerances, this should be made into a GUI config
workspace.screenEdgeTolerance = 15;
workspace.moveAccidentTolerance = 100;
workspace.clientSnapTolerance = 0;
workspace.quickTileTolerance = 5;
workspace.savedClientGeometry = {};
workspace.restoreGeometry = false;


/**
 * Determine if number is near another number.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} tolerance
 * @return {boolean}
 */
function nearToInt(a, b, tolerance) {
  return (b >= a - tolerance) && (b <= a + tolerance);
}


/**
 * Determine if point is near another point.
 *
 * @param {array[x,y]} a
 * @param {array[x,y]} b
 * @param {number} tolerance
 * @return {boolean}
 */
function nearToPoint(a, b, tolerance) {
  if (typeof a === 'undefined' || typeof b === 'undefined')
    return false;

  var isANear = nearToInt(a[0], b[0], tolerance);
  if (a[1] === -1 || b[1] === -1)
    return isANear;

  var isBNear = nearToInt(a[1], b[1], tolerance);
  return isANear && isBNear;
}


/**
 * Main initialization.
 *
 * @return {void}
 */
function main() {
  connectClients();
  workspace.activeFrameId = -1;
}


/**
 * Connect signals to pre-existing and new clients.
 *
 * @return {void}
 */
function connectClients() {
  // Add pre-existing clients
  var clients = workspace.clientList();
  for (var i = clients.length; i > 0; i--)
    onClientAdded(clients[i]);

  // Client add/remove connections
  workspace.clientAdded.connect(onClientAdded);
  workspace.clientRemoved.connect(onClientRemoved);
}


/**
 * Connect signals for window movement and resizing.
 *
 * @param {object} client
 * @return {void}
 */
function onClientAdded(client) {
  // Ignore undefined clients
  if (typeof client === 'undefined')
    return;

  // Connect signals
  client.clientStartUserMovedResized.connect(onClientMove)
  client.clientStepUserMovedResized.connect(onClientMoving);
  client.clientFinishUserMovedResized.connect(onClientMoved);
}


/**
 * Disconnect signals when client is removed.
 *
 * @param {object} client
 * @return {void}
 */
function onClientRemoved(client) {
  // Ignore undefined clients
  if (typeof client === 'undefined')
    return;

  // Disconnect signals
  client.clientStartUserMovedResized.disconnect(onClientMove)
  client.clientStepUserMovedResized.disconnect(onClientMoving);
  client.clientFinishUserMovedResized.disconnect(onClientMoved);
}


/**
 * Called on client pre-movement.
 *
 * @param {object} client
 * @return {void}
 */
function onClientMove(client) {
  // Ignore undefined clients
  if (typeof client === 'undefined')
    return;

  // Cache values
  workspace._clientArea = workspace.clientArea(workspace.MaximizeArea, client);

  // Get screen edge of client
  var screenEdge = getScreenEdge(client);
  if (screenEdge < 0) {
    // Save client's pre-tiled geometry
    workspace.savedClientGeometry[client.frameId] =
      JSON.parse(JSON.stringify(client.geometry))
    return;
  }

  // Get grouped clients
  var clientGroup = getClientGroup(client);
  if (clientGroup.length <= 1)
    return;

  // Set workspace properties
  workspace.activeFrameId = client.frameId;
  workspace.clientScreenEdge = screenEdge;
  workspace.clientGroup = clientGroup;
  workspace.clientGeometry = JSON.parse(JSON.stringify(client.geometry));
}


/**
 * Called repeatedly as a client is resizing/moving.
 *
 * @param {object} client
 * @return {boolean}
 */
function onClientMoving(client) {
  // Should we care about this client?
  if (workspace.restoreGeometry || !isActiveFrame(client))
    return;

  // Auto-resize all tiled clients
  if (wasResized(client))
    resizeTiledClients(client, workspace.clientGroup);

  // Ignore further resizing; this allows us to drag a window out of the
  // snapped mode
  else
    workspace.restoreGeometry = true;
}


/**
 * Called after a client is finished moving.
 *
 * @param {object} client
 * @return {void}
 */
function onClientMoved(client) {
  // Auto-tile client when quick-tiled
  var screenEdge = getScreenEdge(client);
  if (wasQuickTiled(client, screenEdge))
    resizeTiledClient(client, screenEdge, getCenterPoint(client), false);

  // Are we allowed to move this window?
  if (!isActiveFrame(client))
    return;

  // Client resizing
  if (!workspace.restoreGeometry && wasResized(client)) {
    // Resize grouped clients one final time to make sure their corners touch
    resizeTiledClients(client, workspace.clientGroup);
    snapToScreenEdge(client, workspace.clientScreenEdge);
  }

  // Client moving
  else {
    // Prevent accidental client moves
    var currPoint = [client.geometry.x, client.geometry.y];
    var prevPoint = [workspace.clientGeometry.x, workspace.clientGeometry.y];
    if (nearToPoint(currPoint, prevPoint, workspace.moveAccidentTolerance))
      client.geometry = workspace.clientGeometry;

    // Restore saved geometry (before client was tiled)
    else if (workspace.restoreGeometry) {
      var savedGeometry = workspace.savedClientGeometry[client.frameId]
      if (typeof savedGeometry !== 'undefined') {
        // Center frame inside old frame
        // The kwin scripting interface doesn't give access to mouse position
        savedGeometry.x = client.x > 0 ? client.x : 0
        savedGeometry.y = client.y > 0 ? client.y : 0

        // Restore and delete entry
        client.geometry = savedGeometry
        delete workspace.savedClientGeometry[client.frameId]
      }
    }
  }

  // Reset workspace properties
  workspace.activeFrameId = -1;
  workspace.clientGroup = undefined;
  workspace.restoreGeometry = false;
}


/**
 * Get all non-minimized clients belonging to a desktop.
 *
 * @param {number} desktopId
 * @return {array} clients
 */
function getDesktopClients(desktopId) {
  return workspace.clientList().filter(function(client) {
    return typeof client !== 'undefined' &&
      client.minimized === false &&
      client.desktop === desktopId;
  });
}


/**
 * Get group of clients with inner corners in close proximity to one another.
 *
 * @param {object} client
 * @param {array} clients
 * @return {array}
 */
function getClientGroup(client, clients) {
  var result = [];

  // Get master corner point
  var masterScreenEdge = getScreenEdge(client);
  var masterCornerPoint = getInnerCornerPoint(client, masterScreenEdge);
  if (typeof masterCornerPoint === 'undefined')
    return result;

  // Get all clients belonging to same desktop
  if (typeof clients === 'undefined')
    clients = getDesktopClients(client.desktop);

  // Loop through each and see if its grouped with our client
  for (var i = clients.length - 1; i >= 0; i--) {
    if (typeof clients[i] === 'undefined')
      continue;

    // Get relevant corner point of client, ignore if none
    var screenEdge = getScreenEdge(clients[i]);
    var cornerPoint = getInnerCornerPoint(clients[i], screenEdge);
    if (typeof cornerPoint === 'undefined')
      continue;

    // Only windows that have relevant corners points near eachother
    if (!nearToPoint(masterCornerPoint, cornerPoint, workspace.clientSnapTolerance))
      continue;

    // Client is grouped
    result.push([clients[i], screenEdge]);
  }

  return result;
}


/**
 * Determine if client was quick tiled.
 *
 * @param {object} client
 * @return {boolean}
 */
function wasQuickTiled(client) {
  var clientArea = workspace._clientArea;
  var tolerance = workspace.quickTileTolerance
  var quickTileWidth = nearToInt(client.width, clientArea.width / 2, tolerance)
  var quickTileHalfHeight = nearToInt(client.height, clientArea.height / 2, tolerance)
  var quickTileFullHeight = nearToInt(client.height, clientArea.height, tolerance)
  return quickTileWidth && (quickTileHalfHeight || quickTileFullHeight)
}


/**
 * Determine if window was resized.
 *
 * @param {object} client
 * @return {boolean}
 */
function wasResized(client) {
  return (
    workspace.clientGeometry.width != client.geometry.width ||
    workspace.clientGeometry.height != client.geometry.height
  );
}


/**
 * Determine if window belongs to a client group and if its the active frame.
 *
 * @param {object} client
 * @return {boolean}
 */
function isActiveFrame(client) {
  // Ignore clients not in a client group
  if (typeof workspace.clientGroup === 'undefined')
    return false;

  // We only care about the window we're resizing
  if (workspace.activeFrameId !== client.frameId)
    return false;

  return true;
}


/**
 * Get center point of largest client group.
 * Fallback to screen center when no clients are found.
 *
 * @param {object} client
 * @return {array[x,y]}
 */
function getCenterPoint(client) {
  var clients = getDesktopClients(client.desktop);
  var clientGroup = [];

  // Find client group with most client corners in close proximity
  var largestNumber = 0;
  for (var i = clients.length - 1; i >= 0; i--) {
    // Do not try to connect to self
    if (client.frameId === clients[i].frameId)
      continue;

    var tempClientGroup = getClientGroup(clients[i]);
    var tempClientLength = tempClientGroup.length;
    if (tempClientLength < 1 || tempClientLength < largestNumber)
      continue;

    largestNumber = clientGroup.length;
    clientGroup = tempClientGroup
  }

  // Default value at center screen if no grouped clients
  var halfHeight = workspace._clientArea.height / 2
  if (typeof clientGroup[0] === 'undefined')
    return [workspace._clientArea.width / 2, halfHeight];

  // Get inner corner point as the center point
  var result = getInnerCornerPoint(clientGroup[0][0], clientGroup[0][1]);

  // Side tiled clients will have -1 for its Y value
  if (result[1] === -1)
    result[1] = halfHeight

  return result;
}


/**
 * Resize client by setting its geometry property.
 * Ignore negative height and width.
 *
 * @param {object} client
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @return {void}
 */
function resizeClient(client, x, y, width, height) {
  // Disallow negative height and width
  if (height <= 0 || width <= 0)
    return;

  // Set client client.geometry
  client.geometry = { x: x, y: y, width: width, height: height };
}


/**
 * Get screen edge that client is attached to.
 *
 * @param {object} client
 * @return {number}
 */
function getScreenEdge(client) {
  var clientArea = workspace._clientArea;
  var tolerance = workspace.screenEdgeTolerance;

  // Left Side
  if (nearToInt(client.x, clientArea.x, tolerance)) {
    // Left or Top Left
    if (nearToInt(client.y, clientArea.y, tolerance)) {
      // Maximized or Left
      if (nearToInt(client.height, clientArea.height, tolerance)) {
        // Maximized
        if (nearToInt(client.width, clientArea.width, tolerance))
          return ScreenEdge.MAXIMIZED;

        // Left
        else
          return ScreenEdge.LEFT;
      }

      // Top Left
      else
        return ScreenEdge.TOP_LEFT;
    }

    // Bottom Left
    if (nearToInt(client.y + client.height, clientArea.height, tolerance)) {
      return ScreenEdge.BOTTOM_LEFT;
    }
  }

  // Right Side
  if (nearToInt(client.x + client.width, clientArea.width, tolerance)) {
    // Right or Top Right
    if (nearToInt(client.y, clientArea.y, tolerance)) {
      // Right
      if (nearToInt(client.height, clientArea.height, tolerance))
        return ScreenEdge.RIGHT;

      // Top Right
      else
        return ScreenEdge.TOP_RIGHT;
    }

    // Bottom Right
    if (nearToInt(client.y + client.height, clientArea.height, tolerance)) {
      return ScreenEdge.BOTTOM_RIGHT;
    }
  }

  return ScreenEdge.FLOATING;
}


/**
 * Get client corner that is closest to the center of the screen.
 * Side tiled clients will return -1 for its Y value
 *
 * @param {object} client
 * @param {number} screenEdge
 * @return {array[x,y]}
 */
function getInnerCornerPoint(client, screenEdge) {
  if (screenEdge < 0)
    return;

  var width = client.x + client.width;
  var height = client.y + client.height;

  // Get corner based on screen edge
  switch (screenEdge) {
    case ScreenEdge.LEFT:         return [width,    -1];
    case ScreenEdge.RIGHT:        return [client.x, -1];
    case ScreenEdge.TOP_LEFT:     return [width,     height];
    case ScreenEdge.TOP_RIGHT:    return [client.x,  height];
    case ScreenEdge.BOTTOM_LEFT:  return [width,     client.y];
    case ScreenEdge.BOTTOM_RIGHT: return [client.x,  client.y];
  }
}


/**
 * Get client corner that is closest to the outer edges of the screen.
 * Side tiled clients will return -1 for its Y value
 *
 * @param {object} client
 * @param {number} screenEdge
 * @return {array[x,y]}
 */
function getOuterCornerPoint(client, screenEdge) {
  if (screenEdge < 0)
    return;

  var width = client.x + client.width;
  var height = client.y + client.height;

  // Get corner based on screen edge
  switch (screenEdge) {
    case ScreenEdge.LEFT:         return [client.x, -1];
    case ScreenEdge.RIGHT:        return [width,    -1];
    case ScreenEdge.TOP_LEFT:     return [client.x,  client.y];
    case ScreenEdge.TOP_RIGHT:    return [width,     client.y];
    case ScreenEdge.BOTTOM_LEFT:  return [client.x,  height];
    case ScreenEdge.BOTTOM_RIGHT: return [width,     height];
  }
}


/**
 * Ensure a clients border touches the screen edge.
 *
 * @param {object} client
 * @param {array[object]} clients
 * @return {void}
 */
function snapToScreenEdge(client, screenEdge) {
  // Side tiled clients need not apply
  var clientArea = workspace._clientArea;
  var x = client.x;
  var y = client.y;
  var width = client.width;
  var height = client.height;

  // Calculate size
  switch (screenEdge) {
    case ScreenEdge.LEFT:
      y = clientArea.y;
      x = clientArea.x;
      width -= x - client.x;
      height = clientArea.height;
      break;

    case ScreenEdge.RIGHT:
      y = clientArea.y;
      width += clientArea.width - (client.x + client.width);
      height = clientArea.height;
      break;

    case ScreenEdge.TOP_LEFT:
      x = clientArea.x;
      y = clientArea.y;
      width -= x - client.x;
      height -= y - client.y;
      break;

    case ScreenEdge.TOP_RIGHT:
      y = clientArea.y;
      width += clientArea.width - (client.x + client.width);
      height -= y - client.y;
      break;

    case ScreenEdge.BOTTOM_LEFT:
      x = clientArea.x;
      width += x + client.x;
      height += clientArea.height - (client.y + client.height);
      break;

    case ScreenEdge.BOTTOM_RIGHT:
      width += clientArea.width - (client.x + client.width);
      height += clientArea.height - (client.y + client.height);
      break;
  }

  // Resize the client
  return resizeClient(client, x, y, width, height);
}


/**
 * Tile a group of clients.
 *
 * @param {object} client
 * @param {array[object]} clients
 * @return {void}
 */
function tileClients(clients) {
  for (var i = clients.length - 1; i >= 0; i--) {
    if (typeof clients[i] === 'undefined')
      continue;

    tileClient(clients[i][0], clients[i][1])
  }
}


/**
 * Resize a tiled client.
 *
 * @param {object} client
 * @param {number} screenEdge
 * @param {array[x,y]} centerPoint
 * @param {boolean} masterSideTile -- set true if client is side tiled
 * @return {void}
 */
function resizeTiledClient(client, screenEdge, centerPoint, masterSideTile) {
  var clientArea = workspace._clientArea;
  var x = client.geometry.x;
  var y = client.geometry.y;
  var height = client.geometry.height;
  var width = client.geometry.width;

  switch (screenEdge) {
    // Resize left tiled client
    case ScreenEdge.LEFT:
      x = clientArea.x;
      y = clientArea.y;
      width = centerPoint[0];
      height = clientArea.height;
      break;

    // Resize right tiled client
    case ScreenEdge.RIGHT:
      x = centerPoint[0];
      y = clientArea.y;
      width = clientArea.width - centerPoint[0];
      height = clientArea.height;
      break;

    // Resize top left tiled client
    case ScreenEdge.TOP_LEFT:
      x = clientArea.x;
      width = centerPoint[0];
      if (!masterSideTile) {
        y = clientArea.y;
        height = centerPoint[1];
      }

      break;

    // Resize top right tiled client
    case ScreenEdge.TOP_RIGHT:
      x = centerPoint[0];
      width = clientArea.width - centerPoint[0];
      if (!masterSideTile) {
        y = clientArea.y;
        height = centerPoint[1];
      }
      break;

    // Resize bottom right tiled client
    case ScreenEdge.BOTTOM_RIGHT:
      x = centerPoint[0];
      width = clientArea.width - centerPoint[0];
      if (!masterSideTile) {
        y = centerPoint[1];
        height = clientArea.height - centerPoint[1];
      }
      break;

    // Resize bottom left tiled client
    case ScreenEdge.BOTTOM_LEFT:
      x = clientArea.x;
      width = centerPoint[0];
      if (!masterSideTile) {
        y = centerPoint[1];
        height = clientArea.height - centerPoint[1];
      }
      break;
  }

  return resizeClient(client, x, y, width, height);
}


/**
 * Resize/move group of clients into tiled positions.
 *
 * @param {object} client
 * @param {array[object]} clients
 * @return {void}
 */
function resizeTiledClients(masterClient, clients) {
  // Get master client's relevant corner point as the center of all windows
  var screenEdge = workspace.clientScreenEdge
  var centerPoint = getInnerCornerPoint(masterClient, screenEdge)
  if (typeof centerPoint === 'undefined')
    return

  // Let corner tiles know if a side tile is the master
  var sideTile = screenEdge == ScreenEdge.LEFT || screenEdge == ScreenEdge.RIGHT

  // Loop through all clients and resize them
  for (var i = clients.length - 1; i >= 0; i--) {
    // Skip masterClient
    if (clients[i][0].frameId === masterClient.frameId)
      continue

    // Resize clients
    resizeTiledClient(clients[i][0], clients[i][1], centerPoint, sideTile)
  }
}



main();
