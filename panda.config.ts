// https://panda-css.com/docs/references/config
import { defineConfig, defineGlobalStyles } from '@pandacss/dev'
import iconRecipe from './src/recipes/icon'
import convertColorsToPandaCSS from './src/util/convertColorsToPandaCSS'

const { colorTokens, colorSemanticTokens } = convertColorsToPandaCSS()

const globalCss = defineGlobalStyles({
  /* z-index schedule
   Keep these in one place to make it easier to determine interactions and prevent conflicts.
   Javascript should use z-index-* classnames so that z-indexes themselves are all defined here. */
  ':root': {
    '--z-index-popup': '1500',
    '--z-index-gesture-trace': '50',
    '--z-index-command-palette': '45',
    '--z-index-modal': '40',
    '--z-index-hamburger-menu': '30',
    '--z-index-sidebar': '25',
    '--z-index-toolbar-container': '20',
    '--z-index-toolbar-overlay': '15',
    '--z-index-toolbar-arrow': '15',
    '--z-index-toolbar': '10',
    '--z-index-navbar': '10',
    '--z-index-latest-shortcuts': '10',
    '--z-index-tutorial-trace-gesture': '5',
    '--z-index-drop-empty': '6',
    '--z-index-subthoughts-drop-end': '5',
    '--z-index-tutorial': '3',
    '--z-index-scroll-zone': '2',
    '--z-index-thought-annotation-link': '2',
    '--z-index-resizer': '2',
    '--z-index-bullet': '2',
    '--z-index-stack': '1',
    '--z-index-hide': '-1',
    '--safe-area-top': 'env(safe-area-inset-top)',
    '--safe-area-bottom': 'env(safe-area-inset-bottom)',
  },
  'html, body, #root, #app': { height: '100%', fontSize: '16px' },
  'body, textarea': {
    fontWeight: 300,
    fontFamily: "'Helvetica'",
    lineHeight: 1.25,
  },
  /* Disables pull-to-refresh but allows overscroll glow effects. */
  body: { overscrollBehaviorY: 'contain', color: 'fg', backgroundColor: 'bg' },
  button: { fontSize: '1.2em' },
  a: {
    cursor: 'pointer',
    textDecorationLine: 'underline',
    outline: 'none',
    color: '#1b6f9a',
    fontWeight: 400,
    userSelect: 'none',
  },
  h1: {
    fontSize: '32px',
    fontWeight: 400,
    marginTop: '0',
    marginBottom: '12px',
  },
  h2: {
    fontSize: '100%',
    fontWeight: 300,
    borderBottom: 'solid 1px {colors.fg}',
    marginBottom: '25px',
  },
  ul: { marginLeft: '1.5em', paddingLeft: '0' },
  li: { listStyle: 'none' },
  input: {
    color: 'fg',
    border: 'solid 1px {colors.bgMuted}',
    backgroundColor: 'bg',
  },
  "input[type='email'], input[type='password'], input[type='text']": {
    width: '40%',
    minWidth: '300px',
    display: 'block',
    margin: '0 auto',
    padding: '10px',
    fontSize: '16px',
    border: 'solid 1px {colors.bgMuted}',
    borderRadius: '5px',
    marginBottom: '2vh',
  },
  'input:focus': {
    border: {
      base: 'solid 1px #eee',
      _dark: 'solid 1px #999',
    },
    outline: '0 none',
  },
  /** Aligns checkbox and label vertically. */
  "input[type='checkbox']": {
    verticalAlign: 'middle',
    position: 'relative',
    bottom: '1px',
  },
  label: { display: 'block' },
  textarea: {
    width: 'calc(100% - 40px)',
    display: 'block',
    margin: '0 auto',
    height: '50vh',
    padding: '10px',
    fontSize: '16px',
    border: 'solid 1px {colors.bgMuted}',
    color: 'fg',
    backgroundColor: 'bg',
  },
  'button[disabled]': {
    opacity: 0.25,
    pointerEvents: 'none',
    userSelect: 'none',
    cursor: 'auto',
  },
})

export default defineConfig({
  // Where to look for your css declarations
  include: ['./src/**/*.{js,jsx,ts,tsx}'],

  // Files to exclude
  exclude: [],

  // Disable style props on JSX components
  jsxStyleProps: 'none',

  // Disable Panda-specific shorthand properties
  shorthands: false,

  // Useful for theme customization
  theme: {
    extend: {
      tokens: {
        colors: colorTokens,
        fontSizes: {
          sm: {
            value: '80%',
          },
          md: {
            value: '90%',
          },
        },
        spacing: {
          safeAreaTop: { value: 'env(safe-area-inset-top)' },
          safeAreaBottom: { value: 'env(safe-area-inset-bottom)' },
        },
        zIndex: {
          popup: { value: 1500 },
          gestureTrace: { value: 50 },
          commandPalette: { value: 45 },
          modal: { value: 40 },
          hamburgerMenu: { value: 30 },
          sidebar: { value: 25 },
          toolbarContainer: { value: 20 },
          toolbarOverlay: { value: 15 },
          toolbarArrow: { value: 15 },
          toolbar: { value: 10 },
          navbar: { value: 10 },
          latestShortcuts: { value: 10 },
          tutorialTraceGesture: { value: 5 },
          dropEmpty: { value: 6 },
          subthoughtsDropEnd: { value: 5 },
          tutorial: { value: 3 },
          scrollZone: { value: 2 },
          thoughtAnnotationLink: { value: 2 },
          resizer: { value: 2 },
          bullet: { value: 2 },
          stack: { value: 1 },
          hide: { value: -1 },
        },
      },
      recipes: {
        icon: iconRecipe,
      },
      semanticTokens: {
        colors: {
          ...colorSemanticTokens,
          bgMuted: {
            value: {
              base: '#ddd',
              _dark: '#333',
            },
          },
        },
      },
    },
  },

  globalCss,

  conditions: {
    light: '[data-color-mode=light] &',
    dark: '[data-color-mode=dark] &',
  },

  // The output directory for your css system
  outdir: 'styled-system',
  presets: [],
})
