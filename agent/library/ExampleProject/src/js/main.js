// Import styles
import '../styles/main.css';

// Import mock FileMaker for development
import { initMockFileMaker } from './mock-filemaker.js';
import { createDevControls } from './dev-controls.js';

// Main application code
document.addEventListener('DOMContentLoaded', () => {
  console.log('FileMaker WebViewer app initialized');
  
  // Initialize mock FileMaker in development mode
  if (import.meta.env.DEV) {
    initMockFileMaker();
    createDevControls();
    console.log('🔧 Development mode: Mock FileMaker enabled');
    console.log('💡 Use window.mockFileMaker to interact with the mock');
  } else {
    // Production: Use real FileMaker
    window.FileMaker = window.FileMaker || {};
    window.FileMaker.PerformScript = (script, parameter) => {
      console.log(`FM Script to run: ${script} with parameter:`, parameter);
    };
  }
  
  // Function to receive data from FileMaker
  window.receiveFromFileMaker = (data) => {
    console.log('📥 Received data from FileMaker:', data);
    
    // Process the data here - update your UI based on the received data
    handleFileMakerData(data);
  };
  
  // Initialize the app UI
  initializeApp();
});

/**
 * Handle data received from FileMaker
 */
function handleFileMakerData(data) {
  // Example: Update a data display area
  const dataDisplay = document.getElementById('data-display');
  if (dataDisplay) {
    dataDisplay.innerHTML = `
      <div class="bg-green-50 border border-green-200 rounded p-4 mb-4">
        <h4 class="font-semibold text-green-800 mb-2">📥 Data Received:</h4>
        <pre class="text-xs bg-white p-2 rounded overflow-auto">${JSON.stringify(data, null, 2)}</pre>
      </div>
    `;
  }
  
  // Add your custom data handling logic here
  // For example, populate a table, update form fields, etc.
}

/**
 * Initialize the application UI
 */
function initializeApp() {
  // Add a data display area to the page
  const main = document.querySelector('main .bg-white');
  if (main) {
    const dataDisplayHTML = `
      <div class="mt-6 border-t border-gray-200 pt-6">
        <h3 class="font-semibold text-lg mb-3">Data Display</h3>
        <div id="data-display" class="min-h-[100px]">
          <p class="text-gray-500 italic">No data received yet. Use the mock controls to send data.</p>
        </div>
      </div>
      
      <div class="mt-6 border-t border-gray-200 pt-6">
        <h3 class="font-semibold text-lg mb-3">Test Actions</h3>
        <div class="flex gap-2 flex-wrap">
          <button id="test-get-users" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
            Get Users
          </button>
          <button id="test-get-records" class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
            Get Records
          </button>
          <button id="test-save" class="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700">
            Save Record
          </button>
        </div>
      </div>
    `;
    main.insertAdjacentHTML('beforeend', dataDisplayHTML);
    
    // Set up test button handlers
    setupTestButtons();
  }
}

/**
 * Set up test button event handlers
 */
function setupTestButtons() {
  document.getElementById('test-get-users')?.addEventListener('click', () => {
    window.FileMaker?.PerformScript('GetUsers', { filter: 'active' });
  });
  
  document.getElementById('test-get-records')?.addEventListener('click', () => {
    window.FileMaker?.PerformScript('GetRecords', { limit: 10 });
  });
  
  document.getElementById('test-save')?.addEventListener('click', () => {
    window.FileMaker?.PerformScript('SaveRecord', { 
      recordId: 101, 
      title: 'Updated Project',
      status: 'Active' 
    });
  });
}
