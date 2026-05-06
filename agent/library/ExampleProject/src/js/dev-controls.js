/**
 * Development Controls UI
 * Shows mock FileMaker controls during development
 */

export function createDevControls() {
  // Only show in development mode
  if (import.meta.env.PROD) return;

  const controlsHTML = `
    <div id="dev-controls" class="fixed bottom-4 right-4 bg-gray-900 text-white p-4 rounded-lg shadow-2xl max-w-md z-50">
      <div class="flex justify-between items-center mb-3">
        <h3 class="font-bold text-sm">🔧 Mock FileMaker Controls</h3>
        <button id="toggle-controls" class="text-xs bg-gray-700 px-2 py-1 rounded hover:bg-gray-600">
          Minimize
        </button>
      </div>
      
      <div id="controls-content">
        <div class="space-y-3 text-sm">
          <!-- Send Data Section -->
          <div class="border-t border-gray-700 pt-3">
            <label class="block font-medium mb-2">Send Data to App:</label>
            <select id="mock-data-select" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 mb-2">
              <option value="currentUser">Current User</option>
              <option value="users">All Users</option>
              <option value="records">Records</option>
              <option value="custom">Custom JSON...</option>
            </select>
            <button id="send-data-btn" class="w-full bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded font-medium">
              Send to App
            </button>
          </div>

          <!-- Call Script Section -->
          <div class="border-t border-gray-700 pt-3">
            <label class="block font-medium mb-2">Call FileMaker Script:</label>
            <select id="script-select" class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 mb-2">
              <option value="GetUserData">GetUserData</option>
              <option value="GetRecords">GetRecords</option>
              <option value="GetUsers">GetUsers</option>
              <option value="SaveRecord">SaveRecord</option>
              <option value="DeleteRecord">DeleteRecord</option>
            </select>
            <input 
              id="script-param" 
              type="text" 
              placeholder="Parameter (JSON)" 
              class="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 mb-2"
              value='{"id": 1}'
            />
            <button id="call-script-btn" class="w-full bg-green-600 hover:bg-green-700 px-3 py-2 rounded font-medium">
              Call Script
            </button>
          </div>

          <!-- Script Log -->
          <div class="border-t border-gray-700 pt-3">
            <div class="flex justify-between items-center mb-2">
              <label class="font-medium">Script Log:</label>
              <button id="clear-log-btn" class="text-xs bg-gray-700 px-2 py-1 rounded hover:bg-gray-600">
                Clear
              </button>
            </div>
            <div id="script-log" class="bg-gray-800 rounded p-2 max-h-32 overflow-y-auto text-xs font-mono">
              <div class="text-gray-500">No scripts called yet...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Insert controls into the page
  document.body.insertAdjacentHTML('beforeend', controlsHTML);

  // Set up event listeners
  setupEventListeners();
}

function setupEventListeners() {
  const toggleBtn = document.getElementById('toggle-controls');
  const content = document.getElementById('controls-content');
  const sendDataBtn = document.getElementById('send-data-btn');
  const callScriptBtn = document.getElementById('call-script-btn');
  const clearLogBtn = document.getElementById('clear-log-btn');
  const dataSelect = document.getElementById('mock-data-select');

  let isMinimized = false;

  // Toggle controls
  toggleBtn?.addEventListener('click', () => {
    isMinimized = !isMinimized;
    if (content) {
      content.style.display = isMinimized ? 'none' : 'block';
      toggleBtn.textContent = isMinimized ? 'Expand' : 'Minimize';
    }
  });

  // Send data to app
  sendDataBtn?.addEventListener('click', () => {
    const selectedData = dataSelect?.value;
    
    if (selectedData === 'custom') {
      const customJSON = prompt('Enter custom JSON:');
      try {
        const data = JSON.parse(customJSON || '{}');
        window.mockFileMaker?.sendData(data);
        updateLog(`Sent custom data: ${JSON.stringify(data)}`);
      } catch (e) {
        alert('Invalid JSON: ' + e.message);
      }
    } else {
      const data = window.mockFileMaker?.getData()[selectedData];
      window.mockFileMaker?.sendData(data);
      updateLog(`Sent ${selectedData}: ${JSON.stringify(data)}`);
    }
  });

  // Call FileMaker script
  callScriptBtn?.addEventListener('click', () => {
    const scriptName = document.getElementById('script-select')?.value;
    const paramInput = document.getElementById('script-param')?.value;
    
    let parameter;
    try {
      parameter = paramInput ? JSON.parse(paramInput) : null;
    } catch (e) {
      parameter = paramInput; // Use as string if not valid JSON
    }

    if (window.FileMaker?.PerformScript) {
      window.FileMaker.PerformScript(scriptName, parameter);
      updateLog(`Called script: ${scriptName} with ${JSON.stringify(parameter)}`);
    }
  });

  // Clear log
  clearLogBtn?.addEventListener('click', () => {
    window.mockFileMaker?.clearLog();
    const logDiv = document.getElementById('script-log');
    if (logDiv) {
      logDiv.innerHTML = '<div class="text-gray-500">Log cleared...</div>';
    }
  });
}

function updateLog(message) {
  const logDiv = document.getElementById('script-log');
  if (!logDiv) return;

  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = 'mb-1 pb-1 border-b border-gray-700';
  entry.innerHTML = `<span class="text-gray-400">[${timestamp}]</span> ${message}`;
  
  // Remove placeholder if exists
  const placeholder = logDiv.querySelector('.text-gray-500');
  if (placeholder) {
    logDiv.innerHTML = '';
  }
  
  logDiv.insertBefore(entry, logDiv.firstChild);
  
  // Keep only last 10 entries
  while (logDiv.children.length > 10) {
    logDiv.removeChild(logDiv.lastChild);
  }
}
