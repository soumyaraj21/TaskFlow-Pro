import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter, useDroppable, useDraggable, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import './App.css';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
function TaskCard({ task, allTasks, dependencies, aiSuggestions, onAddDep, onAcceptAI, onRejectAI, simDiff }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: task.id });
  const style = { transform: CSS.Translate.toString(transform) };
  
  const myDeps = dependencies.filter(d => d.successor_id === task.id);
  const predTitles = myDeps.map(d => {
    const p = allTasks.find(t => t.id === d.predecessor_id);
    return p ? p.title : `Task #${d.predecessor_id}`;
  });

  const mySuggestions = aiSuggestions.filter(s => s.task_id === task.id);

  let simShiftDays = null;
  if (simDiff && simDiff.end_date) {
    const from = new Date(simDiff.end_date.from).getTime();
    const to = new Date(simDiff.end_date.to).getTime();
    simShiftDays = Math.round((to - from) / (1000 * 60 * 60 * 24));
  }
  const isSimulated = !!simDiff;

  return (
    <div ref={setNodeRef} style={style} className={`task-card ${isSimulated ? 'simulated' : ''}`}>
      <div className="drag-handle" {...attributes} {...listeners}>::</div>
      <div className="card-content">
        <div className="card-header">
          <h4>{task.title}</h4>
          {task.status !== 'done' && (
            <span className={`badge ${task.computed_status === 'ready' ? 'badge-ready' : 'badge-blocked'}`}>
              {task.computed_status === 'ready' ? 'Ready' : 'Blocked'}
            </span>
          )}
        </div>

        {isSimulated && (
          <div className="sim-badge-container">
            {simShiftDays !== null && simShiftDays > 0 && <span className="sim-badge orange">+{simShiftDays}d</span>}
            {simDiff.computed_status && <span className="sim-badge status-shift">→ {simDiff.computed_status.to}</span>}
          </div>
        )}

        {predTitles.length > 0 && (
          <div className="deps">
            {predTitles.map((pt, i) => <span key={i} className="chip">{pt}</span>)}
          </div>
        )}

        {mySuggestions.length > 0 && (
          <div className="ai-suggestions-list">
            {mySuggestions.map(sug => {
              const p = allTasks.find(t => t.id === sug.suggested_predecessor_id);
              return (
                <div key={sug.id} className="ai-suggestion-chip">
                  <div className="ai-chip-header">
                    <span className="ai-icon">✨ AI</span>
                    <span>Depends on <strong>{p?.title || 'Unknown'}</strong> ({Math.round(sug.confidence * 100)}%)</span>
                  </div>
                  <div className="ai-rationale">{sug.rationale}</div>
                  <div className="ai-actions">
                    <button className="ai-btn-accept" onClick={() => onAcceptAI(sug.id, sug.suggested_predecessor_id, task.id)}>Accept</button>
                    <button className="ai-btn-reject" onClick={() => onRejectAI(sug.id)}>Reject</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <button className="add-dep-btn" onClick={() => onAddDep(task.id)}>+ Dependency</button>
      </div>
    </div>
  );
}

function Column({ id, tasks, allTasks, dependencies, aiSuggestions, onAddDep, onAcceptAI, onRejectAI, simulationDiff }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`column ${isOver ? 'column-over' : ''}`}>
      <h2 className="column-title">{id.replace('_', ' ').toUpperCase()}</h2>
      <div className="task-list">
        {tasks.map(t => (
          <TaskCard 
            key={t.id} 
            task={t} 
            allTasks={allTasks} 
            dependencies={dependencies} 
            aiSuggestions={aiSuggestions}
            onAddDep={onAddDep} 
            onAcceptAI={onAcceptAI}
            onRejectAI={onRejectAI}
            simDiff={simulationDiff ? simulationDiff[t.id] : null}
          />
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [dependencies, setDependencies] = useState([]);
  const [aiSuggestions, setAiSuggestions] = useState([]);
  const [showNewTask, setShowNewTask] = useState(false);
  const [depModalTask, setDepModalTask] = useState(null);
  const [toast, setToast] = useState(null);

  const [simTask, setSimTask] = useState('');
  const [simDays, setSimDays] = useState(1);
  const [simulationDiff, setSimulationDiff] = useState(null);
  
  const [nlQuery, setNlQuery] = useState('');
  const [aiSummary, setAiSummary] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [isAddingDep, setIsAddingDep] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const fetchData = async () => {
    try {
      const [tRes, dRes, aRes] = await Promise.all([ 
        fetch(`${API_URL}/api/tasks`), 
        fetch(`${API_URL}/api/dependencies`),
        fetch(`${API_URL}/api/ai-suggestions`)
      ]);
      if (!tRes.ok || !dRes.ok || !aRes.ok) throw new Error('Failed to fetch data');
      setTasks(await tRes.json());
      setDependencies(await dRes.json());
      setAiSuggestions(await aRes.json());
    } catch (e) {
      showToast(e.message || 'Failed to load data');
    } finally {
      setIsInitialLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const showToast = (msg, type = 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDragEnd = async (result) => {
    const { active, over } = result;
    if (!over || isDragging) return;

    const taskId = active.id;
    const newStatus = over.id;
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status === newStatus) return;

    const oldStatus = task.status;
    const oldComputed = task.computed_status;

    setIsDragging(true);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));

    try {
      const res = await fetch(`${API_URL}/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'API failed');
      }
      fetchData();
    } catch (e) {
      showToast(e.message || 'Failed to update task status');
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: oldStatus, computed_status: oldComputed } : t));
    } finally {
      setIsDragging(false);
    }
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    const title = e.target.title.value;
    const description = e.target.description.value;
    if (!title || isCreatingTask) return;
    setIsCreatingTask(true);
    try {
      const res = await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, status: 'backlog', duration_days: 1 })
      });
      if (res.ok) {
        setShowNewTask(false);
        fetchData();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Error creating task');
      }
    } catch (e) { showToast(e.message || 'Error creating task'); }
    finally { setIsCreatingTask(false); }
  };

  const handleCreateDep = async (e) => {
    e.preventDefault();
    const predId = parseInt(e.target.pred.value);
    if (!predId || isAddingDep) return;
    setIsAddingDep(true);
    try {
      const res = await fetch(`${API_URL}/api/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predecessor_id: predId, successor_id: depModalTask, lag_days: 0, source: 'manual' })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to add dependency');
      } else {
        setDepModalTask(null);
        fetchData();
      }
    } catch (e) { showToast(e.message || 'Error adding dependency'); }
    finally { setIsAddingDep(false); }
  };

  const handleSimulate = async () => {
    if (!simTask || !simDays) return;
    try {
      const res = await fetch(`${API_URL}/api/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: parseInt(simTask), deltaDays: parseInt(simDays) })
      });
      if (res.ok) {
        const { diff } = await res.json();
        const diffMap = {};
        for (const d of diff) diffMap[d.taskId] = d.changes;
        setSimulationDiff(diffMap);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Simulation failed');
      }
    } catch (e) {
      showToast(e.message || 'Simulation failed');
    }
  };
  
  const handleNlSimulate = async () => {
    if (!nlQuery) return;
    setIsAiLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/simulate/nl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: nlQuery })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'AI Simulation failed');
      } else {
        const { diff, summary, extracted } = await res.json();
        const diffMap = {};
        for (const d of diff) diffMap[d.taskId] = d.changes;
        setSimulationDiff(diffMap);
        setAiSummary(summary);
      }
    } catch (e) {
      showToast(e.message || 'Error communicating with AI');
    }
    setIsAiLoading(false);
  };

  const clearSimulation = () => {
    setSimulationDiff(null);
    setAiSummary(null);
  };
  
  const handleAcceptAI = async (sugId, predId, succId) => {
    try {
      const res = await fetch(`${API_URL}/api/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predecessor_id: predId, successor_id: succId, lag_days: 0, source: 'ai_suggested' })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Cycle detected, cannot accept');
        return;
      }
      const patchRes = await fetch(`${API_URL}/api/ai-suggestions/${sugId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' })
      });
      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        showToast(err.error || 'Error marking suggestion accepted');
      }
      fetchData();
    } catch (e) { showToast(e.message || 'Error accepting suggestion'); }
  };
  
  const handleRejectAI = async (sugId) => {
    try {
      const res = await fetch(`${API_URL}/api/ai-suggestions/${sugId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Error rejecting suggestion');
      }
      fetchData();
    } catch (e) { showToast(e.message || 'Error rejecting suggestion'); }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>TaskFlow Pro</h1>
        <button className="new-task-btn" onClick={() => setShowNewTask(true)}>+ New Task</button>
      </header>
      
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}
      
      <div className="layout">
        <div className="sidebar">
          <h3>What-If Simulator</h3>
          <div className="sim-form">
            <select value={simTask} onChange={e => setSimTask(e.target.value)}>
              <option value="">-- Select Task to Delay --</option>
              {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <input type="number" value={simDays} onChange={e => setSimDays(e.target.value)} placeholder="Days to delay" />
            <button className="btn-primary" onClick={handleSimulate}>Simulate</button>
          </div>
          
          <hr className="divider" />
          
          <div className="nl-sim">
            <h4>✨ Natural Language Simulator</h4>
            <textarea 
              value={nlQuery} 
              onChange={e => setNlQuery(e.target.value)} 
              placeholder="e.g. what if Project Planning slips 5 days?"
              rows={3}
            />
            <button className="btn-ai" onClick={handleNlSimulate} disabled={isAiLoading}>
              {isAiLoading ? 'Thinking...' : 'Ask AI Simulator'}
            </button>
            {aiSummary && (
              <div className="ai-summary-box">
                <strong>AI Summary:</strong>
                <p>{aiSummary}</p>
              </div>
            )}
          </div>

          {simulationDiff && <button className="clear-btn" onClick={clearSimulation}>Clear Simulation</button>}
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <div className="board">
            {isInitialLoading ? (
              <div className="empty-state">
                <div className="spinner"></div>
                <p>Loading board...</p>
              </div>
            ) : tasks.length === 0 ? (
              <div className="empty-state">
                <h2>No tasks yet!</h2>
                <p>Click "+ New Task" to get started.</p>
              </div>
            ) : (
              ['backlog', 'in_progress', 'review', 'done'].map(col => (
                <Column 
                  key={col} 
                  id={col} 
                  tasks={tasks.filter(t => t.status === col)} 
                  allTasks={tasks} 
                  dependencies={dependencies} 
                  aiSuggestions={aiSuggestions}
                  onAddDep={setDepModalTask} 
                  onAcceptAI={handleAcceptAI}
                  onRejectAI={handleRejectAI}
                  simulationDiff={simulationDiff}
                />
              ))
            )}
          </div>
        </DndContext>
      </div>

      {showNewTask && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={handleCreateTask}>
            <h2>Create New Task</h2>
            <input name="title" placeholder="Task Title" autoFocus />
            <textarea name="description" placeholder="Task Description" rows="3"></textarea>
            <div className="modal-actions">
              <button type="submit" className="btn-primary" disabled={isCreatingTask}>
                {isCreatingTask ? 'Creating...' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowNewTask(false)} disabled={isCreatingTask}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {depModalTask && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={handleCreateDep}>
            <h2>Add Dependency</h2>
            <p>Select a predecessor for <strong>{tasks.find(t=>t.id === depModalTask)?.title}</strong>:</p>
            <select name="pred">
              <option value="">-- Select Task --</option>
              {tasks.filter(t => t.id !== depModalTask).map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
            <div className="modal-actions">
              <button type="submit" className="btn-primary" disabled={isAddingDep}>
                {isAddingDep ? 'Adding...' : 'Add'}
              </button>
              <button type="button" onClick={() => setDepModalTask(null)} disabled={isAddingDep}>Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
