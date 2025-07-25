import React, { createContext, useContext, useReducer, useCallback, ReactNode } from 'react';
import { useWASM } from '../hooks/useWasm';
import { ToolManager } from '../tools/ToolManager';
import type { ToolType, ToolSettings, DrawingTool } from '../types/tool';
import type { WASMStroke, WASMShape, WASMPoint } from '../types/wasm';
import type { Point, Stroke } from '../interfaces/canvas';
import { logger, ToolDebugger, PerformanceTracker } from '../utils/debug';

// State interface for the whiteboard
interface WhiteboardState {
  // Tool management
  activeTool: DrawingTool;
  settings: ToolSettings;
  allTools: DrawingTool[];
  
  // Drawing state
  currentStroke: Stroke | null;
  strokes: Stroke[];
  selectedStrokes: Set<number>;
  previewShape: Stroke | null;
  
  // UI state
  isDragging: boolean;
  dragStart: Point | null;
  exportFormat: 'png' | 'svg';
  
  // WASM state
  isWasmLoaded: boolean;
  wasmError: string | null;
  
  // Performance tracking
  strokeUpdateTrigger: number;
}

// Action types for the reducer
type WhiteboardAction =
  | { type: 'SET_ACTIVE_TOOL'; payload: ToolType }
  | { type: 'UPDATE_SETTINGS'; payload: Partial<ToolSettings> }
  | { type: 'SET_CURRENT_STROKE'; payload: Stroke | null }
  | { type: 'SET_STROKES'; payload: Stroke[] }
  | { type: 'SET_SELECTED_STROKES'; payload: Set<number> }
  | { type: 'SET_PREVIEW_SHAPE'; payload: Stroke | null }
  | { type: 'SET_DRAGGING'; payload: { isDragging: boolean; dragStart?: Point | null } }
  | { type: 'SET_EXPORT_FORMAT'; payload: 'png' | 'svg' }
  | { type: 'SET_WASM_LOADED'; payload: boolean }
  | { type: 'SET_WASM_ERROR'; payload: string | null }
  | { type: 'TRIGGER_STROKE_UPDATE' }
  | { type: 'CLEAR_CANVAS' }
  | { type: 'SET_ALL_TOOLS'; payload: DrawingTool[] };

// Initial state
const initialState: WhiteboardState = {
  activeTool: {} as DrawingTool, // Will be set by ToolManager
  settings: {
    color: { r: 0, g: 0, b: 0, a: 1 },
    thickness: 2,
    eraserSize: 10
  },
  allTools: [],
  currentStroke: null,
  strokes: [],
  selectedStrokes: new Set(),
  previewShape: null,
  isDragging: false,
  dragStart: null,
  exportFormat: 'png',
  isWasmLoaded: false,
  wasmError: null,
  strokeUpdateTrigger: 0
};

// Reducer function for state management
function whiteboardReducer(state: WhiteboardState, action: WhiteboardAction): WhiteboardState {
  switch (action.type) {
    case 'SET_ACTIVE_TOOL':
      console.log('SET_ACTIVE_TOOL reducer called with:', action.payload)
      console.log('Current allTools:', state.allTools.map(t => t.id))
      const foundTool = state.allTools.find(tool => tool.id === action.payload);
      console.log('Found tool:', foundTool?.id || 'NOT FOUND')
      
      // If tool not found, use the first available tool as fallback
      const toolToUse = foundTool || (state.allTools.length > 0 ? state.allTools[0] : state.activeTool);
      console.log('Using tool:', toolToUse?.id || 'NO TOOL AVAILABLE')
      
      return {
        ...state,
        activeTool: toolToUse
      };
    
    case 'UPDATE_SETTINGS':
      return {
        ...state,
        settings: { ...state.settings, ...action.payload }
      };
    
    case 'SET_CURRENT_STROKE':
      return {
        ...state,
        currentStroke: action.payload
      };
    
    case 'SET_STROKES':
      return {
        ...state,
        strokes: action.payload
      };
    
    case 'SET_SELECTED_STROKES':
      return {
        ...state,
        selectedStrokes: action.payload
      };
    
    case 'SET_PREVIEW_SHAPE':
      return {
        ...state,
        previewShape: action.payload
      };
    
    case 'SET_DRAGGING':
      return {
        ...state,
        isDragging: action.payload.isDragging,
        dragStart: action.payload.dragStart !== undefined ? action.payload.dragStart : state.dragStart
      };
    
    case 'SET_EXPORT_FORMAT':
      return {
        ...state,
        exportFormat: action.payload
      };
    
    case 'SET_WASM_LOADED':
      return {
        ...state,
        isWasmLoaded: action.payload
      };
    
    case 'SET_WASM_ERROR':
      return {
        ...state,
        wasmError: action.payload
      };
    
    case 'TRIGGER_STROKE_UPDATE':
      return {
        ...state,
        strokeUpdateTrigger: state.strokeUpdateTrigger + 1
      };
    
    case 'CLEAR_CANVAS':
      return {
        ...state,
        strokes: [],
        selectedStrokes: new Set(),
        currentStroke: null,
        previewShape: null
      };
    
    case 'SET_ALL_TOOLS':
      return {
        ...state,
        allTools: action.payload
      };
    
    default:
      return state;
  }
}

// Context interface
interface WhiteboardContextType {
  // State
  state: WhiteboardState;
  
  // Tool management
  setActiveTool: (toolType: ToolType) => void;
  updateSettings: (settings: Partial<ToolSettings>) => void;
  
  // Drawing operations
  startDrawing: (point: Point) => void;
  continueDrawing: (point: Point) => void;
  finishDrawing: () => void;

  // Add these methods for real-time sync
  addStroke: (stroke: Stroke) => void;
  setAllStrokes: (strokes: Stroke[]) => void;
  
  // Eraser operations
  eraseAtPoint: (point: Point) => void;
  
  // Selection operations
  selectStrokes: (indices: Set<number>) => void;
  moveSelectedStrokes: (dx: number, dy: number) => void;
  deleteSelectedStrokes: () => void;
  
  // Canvas operations
  clearCanvas: () => void;
  exportCanvas: (format: 'png' | 'svg') => void;
  
  // Utility
  triggerStrokeUpdate: () => void;
  syncStrokesFromWasm: () => void;
}

// Create the context
const WhiteboardContext = createContext<WhiteboardContextType | undefined>(undefined);

// Provider component
interface WhiteboardProviderProps {
  children: ReactNode;
}

export const WhiteboardProvider: React.FC<WhiteboardProviderProps> = ({ children }) => {
  const [state, dispatch] = useReducer(whiteboardReducer, initialState);
  const { drawingEngine: wasmEngine, isLoaded, error } = useWASM();
  
  // Initialize tool manager
  const [toolManager] = React.useState(() => new ToolManager());
  
  // Initialize tools on mount
  React.useEffect(() => {
    console.log('Initializing tools...')
    const allTools = toolManager.getAllTools();
    console.log('Available tools:', allTools.map(t => t.id))
    
    // Set allTools first
    dispatch({ type: 'SET_ALL_TOOLS', payload: allTools });
    
    // Update settings
    dispatch({ type: 'UPDATE_SETTINGS', payload: toolManager.getSettings() });
  }, [toolManager]);
  
  // Set initial active tool after allTools is available
  React.useEffect(() => {
    if (state.allTools.length > 0) {
      const activeTool = toolManager.getActiveTool();
      console.log('Setting initial active tool after allTools loaded:', activeTool.id)
      dispatch({ type: 'SET_ACTIVE_TOOL', payload: activeTool.id as ToolType });
    }
  }, [state.allTools.length, toolManager]);
  
  // Update WASM state
  React.useEffect(() => {
    dispatch({ type: 'SET_WASM_LOADED', payload: isLoaded });
    if (error) {
      dispatch({ type: 'SET_WASM_ERROR', payload: error });
    }
  }, [isLoaded, error]);
  
  // Helper function to convert WASM stroke to React stroke
  const wasmStrokeToReact = useCallback((wasmStroke: WASMStroke): Stroke => {
    if (!wasmStroke) {
      return { points: [], color: 'rgb(0, 0, 0)', thickness: 1 };
    }
    
    if (!wasmStroke.color) {
      return {
        points: wasmStroke.points || [],
        color: 'rgb(0, 0, 0)',
        thickness: wasmStroke.thickness || 1
      };
    }
    
    return {
      points: wasmStroke.points || [],
      color: `rgb(${Math.round((wasmStroke.color.r || 0) * 255)}, ${Math.round((wasmStroke.color.g || 0) * 255)}, ${Math.round((wasmStroke.color.b || 0) * 255)})`,
      thickness: wasmStroke.thickness || 1
    };
  }, []);
  
  // Sync strokes from WASM to React state
  const syncStrokesFromWasm = useCallback(() => {
    if (!isLoaded) {
      console.log('WASM not loaded, skipping stroke sync')
      return;
    }
    
    try {
      PerformanceTracker.start('syncStrokes');
      const wasmStrokes = wasmEngine.getStrokes();
      console.log('Syncing strokes from WASM:', wasmStrokes.length, 'strokes')
      const reactStrokes = wasmStrokes.map(wasmStrokeToReact);
      logger.debug('Syncing strokes from WASM:', wasmStrokes.length, 'strokes');
      dispatch({ type: 'SET_STROKES', payload: reactStrokes });
      PerformanceTracker.end('syncStrokes');
    } catch (err) {
      console.error('Failed to get strokes from WASM:', err);
      logger.error('Failed to get strokes from WASM:', err);
    }
  }, [isLoaded, wasmEngine, wasmStrokeToReact]);
  
  // Tool management
  const setActiveTool = useCallback((toolType: ToolType) => {
    console.log('setActiveTool called with:', toolType)
    console.log('Current allTools:', state.allTools.map(t => t.id))
    
    // Safety check: ensure allTools is available
    if (state.allTools.length === 0) {
      console.log('allTools not available yet, skipping tool change')
      return;
    }
    
    logger.info('Setting active tool to:', toolType);
    toolManager.setActiveTool(toolType);
    const activeTool = toolManager.getActiveTool();
    console.log('ToolManager active tool:', activeTool.id)
    
    dispatch({ type: 'SET_ACTIVE_TOOL', payload: toolType });
    ToolDebugger.logToolChange(state.activeTool.id, toolType);
  }, [toolManager, state.activeTool.id, state.allTools]);
  
  const updateSettings = useCallback((settings: Partial<ToolSettings>) => {
    toolManager.updateSettings(settings);
    dispatch({ type: 'UPDATE_SETTINGS', payload: settings });
  }, [toolManager]);
  
  // Drawing operations
  const startDrawing = useCallback(async (point: Point) => {
    console.log('startDrawing called with point:', point, 'WASM loaded:', isLoaded)
    if (!isLoaded) {
      console.log('WASM not loaded, cannot start drawing')
      return;
    }
    
    try {
      PerformanceTracker.start('strokeCreation');
      const wasmStrokes = wasmEngine.getStrokes();
      console.log('Current WASM strokes before adding:', wasmStrokes.length)
      
      // Start new stroke in WASM
      const wasmStroke: WASMStroke = {
        points: [point],
        color: state.settings.color,
        thickness: state.settings.thickness
      };
      
      console.log('Adding stroke to WASM:', wasmStroke)
      
      // Log drawing operation
      await logger.logDrawing('stroke', {
        mouse: point,
        color: state.settings.color,
        thickness: state.settings.thickness,
        operation: 'start'
      }, wasmStrokes, []);
      
      wasmEngine.addStroke(wasmStroke);
      console.log('Stroke added to WASM, triggering update')
      dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
      PerformanceTracker.end('strokeCreation');
    } catch (err) {
      console.error('WASM stroke error:', err);
      logger.error('WASM stroke error:', err);
      return;
    }
    
    // Set current stroke in React state for immediate UI feedback
    dispatch({
      type: 'SET_CURRENT_STROKE',
      payload: {
        points: [point],
        color: `rgb(${Math.round(state.settings.color.r * 255)}, ${Math.round(state.settings.color.g * 255)}, ${Math.round(state.settings.color.b * 255)})`,
        thickness: state.settings.thickness
      }
    });
  }, [isLoaded, wasmEngine, state.settings]);
  
  const continueDrawing = useCallback(async (point: Point) => {
    console.log('continueDrawing called with point:', point, 'current stroke points:', state.currentStroke?.points.length || 0)
    if (!isLoaded || !state.currentStroke) {
      console.log('Cannot continue drawing:', { isLoaded, hasCurrentStroke: !!state.currentStroke })
      return;
    }
    
    try {
      // Add point to current stroke in WASM
      const strokeIndex = wasmEngine.getStrokes().length - 1;
      console.log('Adding point to WASM stroke index:', strokeIndex)
      wasmEngine.addPointToStroke(strokeIndex, point);
      dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
      
      // Only log every 10th point to reduce overhead
      if (state.currentStroke.points.length % 10 === 0) {
        PerformanceTracker.start('strokePointAddition');
        const wasmStrokes = wasmEngine.getStrokes();
        
        await logger.logDrawing('stroke', {
          mouse: point,
          strokeIndex,
          operation: 'addPoint',
          totalPoints: state.currentStroke.points.length + 1
        }, wasmStrokes, []);
        
        PerformanceTracker.end('strokePointAddition');
      }
    } catch (err) {
      console.error('WASM not ready yet:', err);
      logger.error('WASM not ready yet:', err);
      return;
    }
    
    // Update React state for immediate feedback
    dispatch({
      type: 'SET_CURRENT_STROKE',
      payload: {
        points: [...state.currentStroke.points, point],
        color: state.currentStroke.color,
        thickness: state.currentStroke.thickness
      }
    });
  }, [isLoaded, wasmEngine, state.currentStroke]);
  
  const finishDrawing = useCallback(() => {
    console.log('finishDrawing called, current stroke points:', state.currentStroke?.points.length || 0)
    if (state.currentStroke && state.currentStroke.points.length > 0) {
      try {
        // Ensure the last point is added to the WASM stroke
        const wasmStrokes = wasmEngine.getStrokes();
        const strokeIndex = wasmStrokes.length - 1;
        const lastPoint = state.currentStroke.points[state.currentStroke.points.length - 1];
        console.log('Finishing stroke, adding last point to WASM stroke index:', strokeIndex, 'point:', lastPoint)
        wasmEngine.addPointToStroke(strokeIndex, lastPoint);
        dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
      } catch (err) {
        console.error('WASM not ready yet:', err);
        logger.error('WASM not ready yet:', err);
      }
    }
    
    // Clear current stroke
    console.log('Clearing current stroke')
    dispatch({ type: 'SET_CURRENT_STROKE', payload: null });
  }, [state.currentStroke, wasmEngine]);
  
  // Add a single stroke to the state
  const addStroke = useCallback((stroke: Stroke) => {
    dispatch({ type: 'SET_STROKES', payload: [...state.strokes, stroke] });
  }, [state.strokes]);

  // Replace all strokes in the state
  const setAllStrokes = useCallback((strokes: Stroke[]) => {
    dispatch({ type: 'SET_STROKES', payload: strokes });
  }, []);
  
  // Eraser operations
  const eraseAtPoint = useCallback(async (point: Point) => {
    if (!isLoaded) return;
    
    try {
      PerformanceTracker.start('eraserOperation');
      const wasmStrokes = wasmEngine.getStrokes();
      const eraserSize = state.settings.eraserSize || 10;
      
      for (let i = wasmStrokes.length - 1; i >= 0; i--) {
        const stroke = wasmStrokes[i];
        const reactStroke = wasmStrokeToReact(stroke);
        
        // Check if point is near stroke (simplified collision detection)
        const isNear = reactStroke.points.some(strokePoint => {
          const distance = Math.hypot(point.x - strokePoint.x, point.y - strokePoint.y);
          return distance <= eraserSize;
        });
        
        if (isNear) {
          // Log erasing operation
          await logger.logErasing('eraser', {
            mouse: point,
            eraserSize,
            strokeIndex: i,
            strokeData: reactStroke
          }, wasmStrokes, []);
          
          wasmEngine.removeStroke(i);
          dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
          break;
        }
      }
      
      PerformanceTracker.end('eraserOperation');
    } catch (err) {
      logger.error('WASM not ready yet:', err);
    }
  }, [isLoaded, wasmEngine, state.settings.eraserSize, wasmStrokeToReact]);
  
  // Selection operations
  const selectStrokes = useCallback((indices: Set<number>) => {
    dispatch({ type: 'SET_SELECTED_STROKES', payload: indices });
  }, []);
  
  const moveSelectedStrokes = useCallback((dx: number, dy: number) => {
    if (!isLoaded) return;
    
    try {
      state.selectedStrokes.forEach(index => {
        wasmEngine.moveStroke(index, dx, dy);
      });
      dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
    } catch (err) {
      logger.error('WASM not ready yet:', err);
    }
  }, [isLoaded, wasmEngine, state.selectedStrokes]);
  
  const deleteSelectedStrokes = useCallback(() => {
    if (!isLoaded) return;
    
    const indicesToRemove = Array.from(state.selectedStrokes).sort((a, b) => b - a);
    indicesToRemove.forEach(index => {
      wasmEngine.removeStroke(index);
    });
    dispatch({ type: 'SET_SELECTED_STROKES', payload: new Set() });
    dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
  }, [isLoaded, wasmEngine, state.selectedStrokes]);
  
  // Canvas operations
  const clearCanvas = useCallback(() => {
    if (wasmEngine) {
      wasmEngine.clear();
      dispatch({ type: 'CLEAR_CANVAS' });
    }
  }, [wasmEngine]);
  
  const exportCanvas = useCallback((format: 'png' | 'svg') => {
    dispatch({ type: 'SET_EXPORT_FORMAT', payload: format });
    // Export logic would be implemented in the Canvas component
  }, []);
  
  const triggerStrokeUpdate = useCallback(() => {
    dispatch({ type: 'TRIGGER_STROKE_UPDATE' });
  }, []);
  
  // Sync strokes when WASM updates
  React.useEffect(() => {
    console.log('Stroke update trigger changed:', state.strokeUpdateTrigger)
    if (state.strokeUpdateTrigger > 0) {
      console.log('Triggering stroke sync from WASM')
      syncStrokesFromWasm();
    }
  }, [state.strokeUpdateTrigger, syncStrokesFromWasm]);
  
  const contextValue: WhiteboardContextType = {
    state,
    setActiveTool,
    updateSettings,
    startDrawing,
    continueDrawing,
    finishDrawing,
    eraseAtPoint,
    selectStrokes,
    moveSelectedStrokes,
    deleteSelectedStrokes,
    clearCanvas,
    exportCanvas,
    triggerStrokeUpdate,
    syncStrokesFromWasm,
    addStroke, // Exported for WebSocket sync
    setAllStrokes // Exported for WebSocket sync
  };
  
  return (
    <WhiteboardContext.Provider value={contextValue}>
      {children}
    </WhiteboardContext.Provider>
  );
};

// Custom hook to use the whiteboard context
export const useWhiteboard = (): WhiteboardContextType => {
  const context = useContext(WhiteboardContext);
  if (context === undefined) {
    throw new Error('useWhiteboard must be used within a WhiteboardProvider');
  }
  return context;
}; 