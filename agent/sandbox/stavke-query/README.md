# ExampleProject

Example Description

## Quick Start

```bash
# Install dependencies
npm install

# Start development server with mock FileMaker environment
npm run dev

# Build for production (creates single HTML file)
npm run build
```

## Development

The development server includes a **Mock FileMaker Environment** for testing:
- Interactive controls panel in the bottom-right corner
- Send test data to the app
- Call mock FileMaker scripts
- View script execution logs

## Production Build

Run `npm run build` to create a single, self-contained HTML file in `dist/index.html`.

This file contains all CSS and JavaScript inlined and is ready to embed in FileMaker WebViewer.

## FileMaker Integration

### Send Data from FileMaker to WebViewer

```javascript
window.receiveFromFileMaker({ your: 'data' })
```

### Call FileMaker Scripts from WebViewer

```javascript
window.FileMaker.PerformScript('ScriptName', { param: 'value' })
```

## Customization

- **UI**: Edit `index.html` and use Tailwind CSS classes
- **Styles**: Add custom CSS in `src/styles/main.css`
- **Logic**: Add JavaScript in `src/js/main.js`
- **Mock Data**: Edit `src/js/mock-data.json` for testing

## Project Structure

```
ExampleProject/
├── dist/              # Built files (generated)
├── src/
│   ├── js/
│   │   ├── main.js           # Main application logic
│   │   ├── mock-filemaker.js # Mock FileMaker environment
│   │   ├── dev-controls.js   # Development UI controls
│   │   └── mock-data.json    # Test data
│   └── styles/
│       └── main.css          # Main CSS file
├── index.html         # HTML template
└── package.json       # Dependencies
```

## License

MIT
