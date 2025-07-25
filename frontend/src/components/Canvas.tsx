import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useWhiteboard } from '../contexts/WhiteboardContext'
import { useWASM } from '../hooks/useWasm'
import type { Point } from '../interfaces/canvas'
import { 
  logger, 
  ToolDebugger, 
  EventDebugger
} from '../utils/debug'
import { useWebSocket } from '../hooks/useWebSocket';
import type { Stroke, Message } from '../../../shared/types/messages';
import { v4 as uuidv4 } from 'uuid'; // For unique stroke IDs (install with `npm i uuid`)

function ChatBox({ chatMessages, sendChat, myUserId, myUsername }: {
  chatMessages: { userId: string; username: string; message: string }[];
  sendChat: (message: string) => void;
  myUserId: string;
  myUsername: string;
}) {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (input.trim()) {
      sendChat(input.trim());
      setInput('');
    }
  };

  return (
    <div style={{ border: '1px solid #aaa', padding: 8, marginTop: 16, width: 300 }}>
      <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 8 }}>
        {chatMessages.map((msg, idx) => (
          <div key={idx} style={{ color: msg.userId === myUserId ? 'blue' : 'black' }}>
            <b>{msg.username}:</b> {msg.message}
          </div>
        ))}
      </div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
        placeholder="Type a message…"
        style={{ width: '80%' }}
      />
      <button onClick={handleSend} style={{ width: '18%' }}>Send</button>
    </div>
  );
}

export const Canvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [shapeStart, setShapeStart] = useState<Point | null>(null)
  const [previewShape, setPreviewShape] = useState<{ points: Point[], color: string, thickness: number } | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<Point | null>(null)
  
  const {
    state,
    startDrawing,
    continueDrawing,
    finishDrawing,
    eraseAtPoint,
    selectStrokes,
    moveSelectedStrokes,
    deleteSelectedStrokes,
    clearCanvas,
    triggerStrokeUpdate,
    addStroke, // <-- import from context
    setAllStrokes // <-- import from context
  } = useWhiteboard()
  
  // Get direct access to WASM engine for faster shape creation
  const { drawingEngine: wasmEngine } = useWASM()

  const myUserId = useRef(uuidv4()).current;
  const [chatMessages, setChatMessages] = useState<{ userId: string; username: string; message: string }[]>([]);
  const myUsername = "Anonymous"; // Replace with real username logic if you want

  const handleMessage = useCallback((msg: Message) => {
    switch (msg.type) {
      case 'stroke:add': {
        // Convert color to string for frontend Stroke
        const s = msg.payload.stroke;
        const colorStr = `rgb(${s.color.r}, ${s.color.g}, ${s.color.b})`;
        addStroke({
          points: s.points,
          color: colorStr,
          thickness: s.thickness
        });
        break;
      }
      case 'board:sync': {
        // Convert all strokes' color to string
        const strokes = msg.payload.strokes.map(s => ({
          points: s.points,
          color: `rgb(${s.color.r}, ${s.color.g}, ${s.color.b})`,
          thickness: s.thickness
        }));
        setAllStrokes(strokes);
        break;
      }
      case 'chat:message':
        setChatMessages(prev => [...prev, msg.payload]);
        break;
      case 'chat:sync':
        setChatMessages(msg.payload.chatHistory);
        break;
      default:
        break;
    }
  }, [addStroke, setAllStrokes]);

  const { send } = useWebSocket(handleMessage);

  // When user finishes drawing:
  const onFinishDrawing = (points: Point[], color: any, thickness: number) => {
    const strokeMsg: Message = { type: 'stroke:add', payload: { stroke: { id: uuidv4(), points, color, thickness, userId: myUserId } } };
    console.log('Sending stroke to server:', strokeMsg);
    send(strokeMsg);
  };

  // Debug: Log state changes
  useEffect(() => {
    console.log('Canvas state updated:', {
      activeTool: state.activeTool?.id || 'UNDEFINED',
      isWasmLoaded: state.isWasmLoaded,
      strokesCount: state.strokes.length,
      currentStroke: state.currentStroke ? state.currentStroke.points.length : 0,
      allToolsCount: state.allTools.length
    })
  }, [state.activeTool?.id, state.isWasmLoaded, state.strokes.length, state.currentStroke, state.allTools.length])

  // Helper functions
  const isPointInRect = (pt: Point, x1: number, y1: number, x2: number, y2: number) =>
    pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2

  const isPointNearStroke = (pt: Point, stroke: any, threshold = 8) => {
    for (let i = 0; i < stroke.points.length - 1; i++) {
      const a = stroke.points[i]
      const b = stroke.points[i + 1]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSq = dx * dx + dy * dy
      let t = 0
      if (lengthSq > 0) {
        t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / lengthSq
        t = Math.max(0, Math.min(1, t))
      }
      const projX = a.x + t * dx
      const projY = a.y + t * dy
      const dist = Math.hypot(pt.x - projX, pt.y - projY)
      if (dist <= threshold) return true
    }
    return false
  }

  // Unified event handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!state.isWasmLoaded || !canvasRef.current) {
      console.log('Canvas not ready:', { isWasmLoaded: state.isWasmLoaded, canvas: !!canvasRef.current })
      return
    }
    
    if (!state.activeTool || !state.activeTool.id) {
      console.log('No active tool available:', state.activeTool)
      return
    }
    
    const mouse = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
    setIsDrawing(true)
    
    console.log('Pointer down:', { tool: state.activeTool.id, mouse, buttons: e.buttons })
    
    // Debug logging
    ToolDebugger.logPointerEvent(state.activeTool.id, 'pointerDown', mouse)
    EventDebugger.logMouseEvent('pointerDown', mouse, e.buttons)
    
    // Handle tool-specific logic
    if (state.activeTool.id === 'eraser') {
      ToolDebugger.logToolAction('eraser', 'start', mouse)
      eraseAtPoint(mouse)
    } else if (state.activeTool.id === 'select') {
      ToolDebugger.logToolAction('select', 'start', mouse)
      handleSelectDown(mouse)
    } else if (state.activeTool.id === 'stroke') {
      ToolDebugger.logToolAction('stroke', 'start', mouse)
      console.log('Starting stroke drawing')
      startDrawing(mouse)
    } else if (state.activeTool.id === 'rectangle' || state.activeTool.id === 'ellipse') {
      ToolDebugger.logToolAction(state.activeTool.id, 'start', mouse)
      setShapeStart(mouse)
      handleShapeDown(mouse)
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!state.isWasmLoaded || !canvasRef.current) return
    
    if (!state.activeTool || !state.activeTool.id) return
    
    const mouse = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
    
    // Only handle move operations when mouse button is pressed (e.buttons > 0)
    if (e.buttons === 0) {
      // Mouse is moving but no button is pressed - just update preview
      if (state.activeTool.id === 'rectangle' || state.activeTool.id === 'ellipse') {
        handleShapeMove(mouse)
      }
      return
    }
    
    // Handle tool-specific logic when mouse button is pressed
    if (state.activeTool.id === 'eraser') {
      eraseAtPoint(mouse)
    } else if (state.activeTool.id === 'select') {
      handleSelectMove(mouse)
    } else if (state.activeTool.id === 'stroke') {
      console.log('Continuing stroke drawing')
      continueDrawing(mouse)
    } else if (state.activeTool.id === 'rectangle' || state.activeTool.id === 'ellipse') {
      handleShapeMove(mouse)
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!state.isWasmLoaded || !canvasRef.current) return
    
    if (!state.activeTool || !state.activeTool.id) return
    
    const mouse = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }
    setIsDrawing(false)
    
    console.log('Pointer up:', { tool: state.activeTool.id, mouse })
    
    // Handle tool-specific logic
    if (state.activeTool.id === 'select') {
      handleSelectUp()
    } else if (state.activeTool.id === 'stroke') {
      console.log('Finishing stroke drawing')
      finishDrawing()
    } else if (state.activeTool.id === 'rectangle' || state.activeTool.id === 'ellipse') {
      handleShapeUp(mouse)
      setShapeStart(null)
      setPreviewShape(null) // Clear preview shape
    }
  }

  // Selection handlers
  const handleSelectDown = (mouse: Point) => {
    // Check if clicking on a selected item to start dragging
    if (state.selectedStrokes.size > 0) {
      let inside = false
      state.strokes.forEach((stroke, i) => {
        if (state.selectedStrokes.has(i)) {
          for (const pt of stroke.points) {
            if (isPointInRect(mouse, pt.x - 5, pt.y - 5, pt.x + 5, pt.y + 5)) {
              inside = true
              break
            }
          }
        }
      })
      if (inside) {
        // Start dragging selected items
        setIsDragging(true)
        setDragStart(mouse)
        return
      }
    }
    
    // Check if clicking on any stroke to select it
    let strokeClicked = false
    state.strokes.forEach((stroke, i) => {
      if (!strokeClicked) {
        for (const pt of stroke.points) {
          if (isPointInRect(mouse, pt.x - 5, pt.y - 5, pt.x + 5, pt.y + 5)) {
            selectStrokes(new Set([i]))
            strokeClicked = true
            break
          }
        }
      }
    })
    
    // If no stroke was clicked, clear selection
    if (!strokeClicked) {
      selectStrokes(new Set())
    }
  }

  const handleSelectMove = (mouse: Point) => {
    if (isDragging && dragStart) {
      const dx = mouse.x - dragStart.x
      const dy = mouse.y - dragStart.y
      moveSelectedStrokes(dx, dy)
      // Update drag start to current position for continuous movement
      setDragStart(mouse)
    }
  }

  const handleSelectUp = () => {
    // End dragging
    setIsDragging(false)
    setDragStart(null)
  }

  // Shape handlers - now properly implemented
  const handleShapeDown = (mouse: Point) => {
    console.log('Starting shape drawing:', state.activeTool.id)
    // Shape drawing will be handled in move/up events
  }

  const handleShapeMove = (mouse: Point) => {
    if (!shapeStart) return
    
    console.log('Drawing shape preview:', state.activeTool.id, { start: shapeStart, current: mouse })
    
    // Create preview shape based on tool type
    if (state.activeTool.id === 'rectangle') {
      const points = [
        { x: shapeStart.x, y: shapeStart.y },
        { x: mouse.x, y: shapeStart.y },
        { x: mouse.x, y: mouse.y },
        { x: shapeStart.x, y: mouse.y },
        { x: shapeStart.x, y: shapeStart.y }
      ]
      
      // Update local preview shape for real-time display
      setPreviewShape({
        points: points,
        color: `rgb(${Math.round(state.settings.color.r * 255)}, ${Math.round(state.settings.color.g * 255)}, ${Math.round(state.settings.color.b * 255)})`,
        thickness: state.settings.thickness
      })
      
    } else if (state.activeTool.id === 'ellipse') {
      const centerX = (shapeStart.x + mouse.x) / 2
      const centerY = (shapeStart.y + mouse.y) / 2
      const radiusX = Math.abs(mouse.x - shapeStart.x) / 2
      const radiusY = Math.abs(mouse.y - shapeStart.y) / 2
      
      const points: Point[] = []
      const segments = 32
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI
        points.push({
          x: centerX + radiusX * Math.cos(angle),
          y: centerY + radiusY * Math.sin(angle)
        })
      }
      
      // Update local preview shape for real-time display
      setPreviewShape({
        points: points,
        color: `rgb(${Math.round(state.settings.color.r * 255)}, ${Math.round(state.settings.color.g * 255)}, ${Math.round(state.settings.color.b * 255)})`,
        thickness: state.settings.thickness
      })
    }
  }

  const handleShapeUp = (mouse: Point) => {
    if (!shapeStart) return
    
    console.log('Finishing shape drawing:', state.activeTool.id, { start: shapeStart, end: mouse })
    
    if (state.activeTool.id === 'rectangle') {
      // Create rectangle shape using proper shape creation
      const rectangleShape = {
        type: 'rectangle' as const,
        topLeft: {
          x: Math.min(shapeStart.x, mouse.x),
          y: Math.min(shapeStart.y, mouse.y)
        },
        bottomRight: {
          x: Math.max(shapeStart.x, mouse.x),
          y: Math.max(shapeStart.y, mouse.y)
        },
        color: state.settings.color,
        thickness: state.settings.thickness
      }
      
      // Use the WASM engine's addShape method which handles rectangle conversion properly
      try {
        // Use direct WASM engine access for faster shape creation
        if (wasmEngine) {
          wasmEngine.addShape(rectangleShape)
          // Trigger stroke update to refresh the display
          triggerStrokeUpdate()
        } else {
          throw new Error('WASM engine not available')
        }
      } catch (error) {
        console.error('Failed to add rectangle shape:', error)
        // Fallback to stroke-based approach if WASM fails
        const points = [
          { x: shapeStart.x, y: shapeStart.y },
          { x: mouse.x, y: shapeStart.y },
          { x: mouse.x, y: mouse.y },
          { x: shapeStart.x, y: mouse.y },
          { x: shapeStart.x, y: shapeStart.y }
        ]
        
        if (points.length > 0) {
          startDrawing(points[0])
          for (let i = 1; i < points.length; i++) {
            continueDrawing(points[i])
          }
          finishDrawing()
        }
      }
      
    } else if (state.activeTool.id === 'ellipse') {
      const centerX = (shapeStart.x + mouse.x) / 2
      const centerY = (shapeStart.y + mouse.y) / 2
      const radiusX = Math.abs(mouse.x - shapeStart.x) / 2
      const radiusY = Math.abs(mouse.y - shapeStart.y) / 2
      
      // Create ellipse points with proper closure
      const points: Point[] = []
      const segments = 32
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * 2 * Math.PI
        points.push({
          x: centerX + radiusX * Math.cos(angle),
          y: centerY + radiusY * Math.sin(angle)
        })
      }
      
      // Create stroke shape for ellipse (since ellipse shapes aren't implemented in WASM yet)
      const ellipseShape = {
        type: 'stroke' as const,
        points: points,
        color: state.settings.color,
        thickness: state.settings.thickness
      }
      
      try {
        // Use direct WASM engine access for faster shape creation
        if (wasmEngine) {
          wasmEngine.addShape(ellipseShape)
          // Trigger stroke update to refresh the display
          triggerStrokeUpdate()
        } else {
          throw new Error('WASM engine not available')
        }
      } catch (error) {
        console.error('Failed to add ellipse shape:', error)
        // Fallback to stroke-based approach if WASM fails
        if (points.length > 0) {
          startDrawing(points[0])
          for (let i = 1; i < points.length; i++) {
            continueDrawing(points[i])
          }
          finishDrawing()
        }
      }
    }
  }

  // Draw all strokes + current stroke + selection rectangle + preview shapes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    console.log('Drawing strokes:', state.strokes.length, 'current stroke points:', state.currentStroke?.points.length || 0)

    // Draw all strokes (highlight selected)
    state.strokes.forEach((stroke, i) => {
      if (!stroke.points || stroke.points.length === 0) return;
      ctx.save()
      ctx.strokeStyle = state.selectedStrokes.has(i) ? "rgba(0, 255, 0, 0.8)" : stroke.color
      ctx.lineWidth = stroke.thickness
      ctx.beginPath()
      if (stroke.points[0] && typeof stroke.points[0].x === 'number' && typeof stroke.points[0].y === 'number') {
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
        stroke.points.forEach(pt => {
          if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
            ctx.lineTo(pt.x, pt.y)
          }
        })
      }
      ctx.stroke()
      ctx.restore()
    })

    // Draw the current stroke
    if (state.currentStroke && state.currentStroke.points.length > 1) {
      ctx.save()
      ctx.strokeStyle = state.currentStroke.color
      ctx.lineWidth = state.currentStroke.thickness
      ctx.beginPath()
      ctx.moveTo(state.currentStroke.points[0].x, state.currentStroke.points[0].y)
      state.currentStroke.points.forEach(pt => ctx.lineTo(pt.x, pt.y))
      ctx.stroke()
      ctx.restore()
    }

    // Draw local preview shape (for real-time shape preview during dragging)
    if (previewShape && previewShape.points.length > 1) {
      ctx.save()
      ctx.strokeStyle = previewShape.color
      ctx.lineWidth = previewShape.thickness
      ctx.setLineDash([5, 5]) // Dashed line for preview
      ctx.beginPath()
      ctx.moveTo(previewShape.points[0].x, previewShape.points[0].y)
      previewShape.points.forEach(pt => ctx.lineTo(pt.x, pt.y))
      ctx.stroke()
      ctx.restore()
    }
    
    // Draw context preview shape (for other previews)
    if (state.previewShape && state.previewShape.points.length > 1) {
      ctx.save()
      ctx.strokeStyle = state.previewShape.color
      ctx.lineWidth = state.previewShape.thickness
      ctx.setLineDash([5, 5]) // Dashed line for preview
      ctx.beginPath()
      ctx.moveTo(state.previewShape.points[0].x, state.previewShape.points[0].y)
      state.previewShape.points.forEach(pt => ctx.lineTo(pt.x, pt.y))
      ctx.stroke()
      ctx.restore()
    }
  }, [state.strokes, state.currentStroke, state.activeTool.id, state.selectedStrokes, state.previewShape, previewShape])

  if (state.wasmError) {
    return <div>Error loading WASM: {state.wasmError}</div>
  }

  if (!state.isWasmLoaded) {
    return <div>Loading WASM...</div>
  }

  const sendChat = (message: string) => {
    send({
      type: 'chat:message',
      payload: {
        userId: myUserId,
        username: myUsername,
        message
      }
    });
  };

  return (
    <>
      <div style={{ margin: "1em 0" }}>
        <div style={{ marginBottom: "10px", fontSize: "12px", color: "#666" }}>
          Debug: Tool: {state.activeTool?.id || 'UNDEFINED'} | Strokes: {state.strokes.length} | 
          Current: {state.currentStroke?.points.length || 0} | 
          Drawing: {isDrawing ? 'Yes' : 'No'}
        </div>
        <label>
          Export as:{" "}
          <select value={state.exportFormat} onChange={e => {
            // This would need to be implemented in the context
          }}>
            <option value="png">PNG</option>
            <option value="svg">SVG</option>
          </select>
        </label>
        <button
          onClick={deleteSelectedStrokes}
          disabled={state.selectedStrokes.size === 0}
        >
          Delete Selected
        </button>
        <button onClick={() => {
          // Export logic would be implemented here
        }}>Save</button>
        <button onClick={clearCanvas}>Clear All</button>
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        style={{ 
          border: '2px solid #333', 
          background: 'white', 
          cursor: isDragging ? 'grabbing' : (state.activeTool?.cursor || 'default') 
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
      <ChatBox
        chatMessages={chatMessages}
        sendChat={sendChat}
        myUserId={myUserId}
        myUsername={myUsername}
      />
    </>
  )
}