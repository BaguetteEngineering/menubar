var path = require('path')
var events = require('events')
var fs = require('fs')

var electron = require('electron')
var app = electron.app
var Tray = electron.Tray
var BrowserWindow = electron.BrowserWindow

var extend = require('extend')
var Positioner = require('electron-positioner')

module.exports = function create (opts) {
  if (typeof opts === 'undefined') opts = {dir: app.getAppPath()}
  if (typeof opts === 'string') opts = {dir: opts}
  if (!opts.dir) opts.dir = app.getAppPath()
  if (!(path.isAbsolute(opts.dir))) opts.dir = path.resolve(opts.dir)
  if (!opts.index) opts.index = 'file://' + path.join(opts.dir, 'index.html')
  //if (!opts.windowPosition) opts.windowPosition = (process.platform === 'win32') ? 'trayBottomCenter' : 'trayCenter'
  if (typeof opts.showDockIcon === 'undefined') opts.showDockIcon = false

  // set width/height on opts to be usable before the window is created
  opts.width = opts.width || 400
  opts.height = opts.height || 400
  opts.tooltip = opts.tooltip || ''

  var menubar = new events.EventEmitter()
  menubar.app = app

  if (app.isReady()) appReady()
  else app.on('ready', appReady)

  // Set / get options
  menubar.setOption = function (opt, val) {
    opts[opt] = val
  }

  menubar.getOption = function (opt) {
    return opts[opt]
  }

  return menubar

  function appReady () {
    if (app.dock && !opts.showDockIcon) app.dock.hide()

    var trayImage = opts.icon || path.join(opts.dir, 'IconTemplate.png')
    if (typeof trayImage === 'string' && !fs.existsSync(trayImage)) trayImage = path.join(__dirname, 'example', 'IconTemplate.png') // default cat icon

    var cachedBounds // cachedBounds are needed for double-clicked event
    var defaultClickEvent = opts.showOnRightClick ? 'right-click' : 'click'

    menubar.tray = opts.tray || new Tray(trayImage)
    menubar.tray.on(defaultClickEvent, clicked)
    menubar.tray.on('double-click', clicked)
    menubar.tray.setToolTip(opts.tooltip)

    // Multi-Taskbar
    // overwrite opts.windowPosition when tray item position is available
    switch (process.platform) {
      // macOS
      // supports top taskbars
      case 'darwin':
        opts.windowPosition = 'trayCenter'
        break
      // Linux
      // supports top taskbars
      case 'linux':
        opts.windowPosition = 'topRight'
        break
      // Windows
      // supports top/bottom/left/right taskbar, default bottom
      case 'win32':
        var trayBounds = menubar.tray.getBounds();
        var traySide = 'bottom';

        // Determine taskbar location
        if ((trayBounds.width !== trayBounds.height) && (trayBounds.y === 0)) { traySide = 'top' }
        if ((trayBounds.width !== trayBounds.height) && (trayBounds.y > 0)) { traySide = 'bottom' }
        if ((trayBounds.width === trayBounds.height) && (trayBounds.x < trayBounds.y)) { traySide = 'left' }
        if ((trayBounds.width === trayBounds.height) && (trayBounds.x > trayBounds.y)) { traySide = 'right' }

        // Assign position for menubar
        if (traySide === 'top') { opts.windowPosition = 'trayCenter' }
        if (traySide === 'bottom') { opts.windowPosition = 'trayBottomCenter' }
        if (traySide === 'left') { opts.windowPosition = 'bottomLeft' }
        if (traySide === 'right') { opts.windowPosition = 'bottomRight' }

        break
    }

    var supportsTrayHighlightState = false
    try {
      menubar.tray.setHighlightMode('never')
      supportsTrayHighlightState = true
    } catch (e) {}

    if (opts.preloadWindow) {
      createWindow()
    }

    menubar.showWindow = showWindow
    menubar.hideWindow = hideWindow
    menubar.emit('ready')

    function clicked (e, bounds) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return hideWindow()
      if (menubar.window && menubar.window.isVisible()) return hideWindow()
      cachedBounds = bounds || cachedBounds
      showWindow(cachedBounds)
    }

    function createWindow () {
      menubar.emit('create-window')
      var defaults = {
        show: false,
        frame: false
      }

      var winOpts = extend(defaults, opts)
      menubar.window = new BrowserWindow(winOpts)

      menubar.positioner = new Positioner(menubar.window)

      menubar.window.on('blur', function () {
        opts.alwaysOnTop ? emitBlur() : hideWindow()
      })

      if (opts.showOnAllWorkspaces !== false) {
        menubar.window.setVisibleOnAllWorkspaces(true)
      }

      menubar.window.on('close', windowClear)
      menubar.window.loadURL(opts.index)
      menubar.emit('after-create-window')
    }

    function showWindow (trayPos) {
      if (supportsTrayHighlightState) menubar.tray.setHighlightMode('always')
      if (!menubar.window) {
        createWindow()
      }

      menubar.emit('show')

      if (trayPos && trayPos.x !== 0) {
        // Cache the bounds
        cachedBounds = trayPos
      } else if (cachedBounds) {
        // Cached value will be used if showWindow is called without bounds data
        trayPos = cachedBounds
      } else if (menubar.tray.getBounds) {
        // Get the current tray bounds
        trayPos = menubar.tray.getBounds()
      }

      // Default the window to the right if `trayPos` bounds are undefined or null.
      var noBoundsPosition = null
      if ((trayPos === undefined || trayPos.x === 0) && (opts.windowPosition && opts.windowPosition.startsWith('tray'))) {
        noBoundsPosition = (process.platform === 'win32') ? 'bottomRight' : 'topRight'
      }

      var position = menubar.positioner.calculate(noBoundsPosition || opts.windowPosition, trayPos)

      var x = (opts.x !== undefined) ? opts.x : position.x
      var y = (opts.y !== undefined) ? opts.y : position.y

      // Multi-Taskbar: optimize vertical position
      if (process.platform === 'win32') {
          if (opts.windowPosition && opts.windowPosition.startsWith('bottom')) {
            y = parseInt(trayPos.y + (trayPos.height/2) - (menubar.window.getBounds().height/2))
          }
      }

      menubar.window.setPosition(x, y)
      menubar.window.show()
      menubar.emit('after-show')
      return
    }

    function hideWindow () {
      if (supportsTrayHighlightState) menubar.tray.setHighlightMode('never')
      if (!menubar.window) return
      menubar.emit('hide')
      menubar.window.hide()
      menubar.emit('after-hide')
    }

    function windowClear () {
      delete menubar.window
      menubar.emit('after-close')
    }

    function emitBlur () {
      menubar.emit('focus-lost')
    }
  }
}
