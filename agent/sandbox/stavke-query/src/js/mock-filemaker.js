/**
 * Mock FileMaker Environment for Testing
 * This simulates FileMaker's interaction with the WebViewer
 */

// Sample mock data that simulates what FileMaker might send
export const mockData = {
  users: [
    { id: 1, name: "John Doe", email: "john@example.com", role: "Admin" },
    { id: 2, name: "Jane Smith", email: "jane@example.com", role: "User" },
    { id: 3, name: "Bob Johnson", email: "bob@example.com", role: "User" }
  ],
  currentUser: {
    id: 1,
    name: "John Doe",
    permissions: ["read", "write", "delete"]
  },
  records: [
    { recordId: 101, title: "Project Alpha", status: "Active", date: "2025-10-01" },
    { recordId: 102, title: "Project Beta", status: "Pending", date: "2025-10-05" },
    { recordId: 103, title: "Project Gamma", status: "Completed", date: "2025-09-28" }
  ]
};

/**
 * Mock FileMaker Script Execution
 * This simulates calling a FileMaker script from the WebViewer
 */
export class MockFileMaker {
  constructor() {
    this.scriptLog = [];
    this.mockResponses = {
      'GetUserData': mockData.currentUser,
      'GetRecords': mockData.records,
      'GetUsers': mockData.users,
      'SaveRecord': { success: true, message: 'Record saved successfully' },
      'DeleteRecord': { success: true, message: 'Record deleted successfully' }
    };
  }

  /**
   * Simulate FileMaker's PerformScript function
   */
  PerformScript(scriptName, parameter) {
    console.log(`[Mock FM] Script called: ${scriptName}`);
    console.log(`[Mock FM] Parameter:`, parameter);
    
    // Log the script call
    this.scriptLog.push({
      timestamp: new Date().toISOString(),
      scriptName,
      parameter
    });

    // Simulate async response from FileMaker
    setTimeout(() => {
      const response = this.mockResponses[scriptName] || { 
        success: false, 
        message: `Unknown script: ${scriptName}` 
      };
      
      console.log(`[Mock FM] Response from ${scriptName}:`, response);
      
      // Send response back to the app
      if (window.receiveFromFileMaker) {
        window.receiveFromFileMaker({
          scriptName,
          data: response,
          timestamp: new Date().toISOString()
        });
      }
    }, 500); // Simulate 500ms delay
  }

  /**
   * Get the log of all script calls
   */
  getScriptLog() {
    return this.scriptLog;
  }

  /**
   * Add or update a mock response for a script
   */
  setMockResponse(scriptName, response) {
    this.mockResponses[scriptName] = response;
  }

  /**
   * Clear the script log
   */
  clearLog() {
    this.scriptLog = [];
  }
}

/**
 * Initialize mock FileMaker environment
 */
export function initMockFileMaker() {
  const mock = new MockFileMaker();
  
  // Replace the FileMaker object with our mock
  window.FileMaker = mock;
  
  console.log('[Mock FM] Mock FileMaker environment initialized');
  console.log('[Mock FM] Available mock scripts:', Object.keys(mock.mockResponses));
  
  // Add a helper to the window for testing
  window.mockFileMaker = {
    sendData: (data) => {
      console.log('[Mock FM] Sending data to app:', data);
      if (window.receiveFromFileMaker) {
        window.receiveFromFileMaker(data);
      }
    },
    getLog: () => mock.getScriptLog(),
    clearLog: () => mock.clearLog(),
    setResponse: (scriptName, response) => mock.setMockResponse(scriptName, response),
    getData: () => mockData
  };

  return mock;
}
