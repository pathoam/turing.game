'use client';
import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/useSocket';  // This is your existing socket hook
import { Dialog } from '@headlessui/react';
import { 
    Participant, 
    Assistant, 
    AssistantResponse, 
    ParticipantsResponse 
} from '../types';


// Define the types we need



interface ProfileProps {
    data: any;
    isLoading: boolean;
    address: string;  // Add this to maintain compatibility
  }
  

  export function UserProfile({ data, isLoading, address }: ProfileProps) {
    const handleDeposit = () => {
      console.log('Deposit clicked - to be implemented');
      // Will handle Solana deposit later
    };
  
    const handleWithdraw = () => {
      console.log('Withdraw clicked - to be implemented');
      // Will handle Solana withdrawal later
    };
  
    if (isLoading) {
      return <div className="flex justify-center"><span className="loading loading-spinner loading-lg"></span></div>;
    }
  
    return (
        <div className="space-y-6">
          <div className="card bg-base-200 p-6">
            <h2 className="text-xl font-semibold mb-4 text-center">Statistics</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-sm opacity-70">Games Played</p>
                <p className="text-2xl">{data?.gamesPlayed || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-sm opacity-70">Wins</p>
                <p className="text-2xl">{data?.wins || 0}</p>
              </div>
              <div className="text-center">
                <p className="text-sm opacity-70">Win Rate</p>
                <p className="text-2xl">
                  {data?.gamesPlayed 
                    ? `${((data.wins || 0) / data.gamesPlayed * 100).toFixed(1)}%` 
                    : '0%'}
                </p>
              </div>
              <div className="text-center">
                <p className="text-sm opacity-70">ELO Rating</p>
                <p className="text-2xl">{data?.elo || 1000}</p>
              </div>
              <div className="text-center">
                <p className="text-sm opacity-70">Account PnL</p> 
                <p className="text-2xl">${data?.usdcBalance?.toFixed(2) || '0.00'}</p>
              </div>
              <div className="text-center">
                <p className="text-sm opacity-70">Total Winnings</p>
                <p className="text-2xl">${data?.winnings?.toFixed(2) || '0.00'}</p>
              </div>
            </div>
          </div>
      
          <div className="card bg-base-200 p-6">
            <h2 className="text-xl font-semibold mb-4 text-center">Balances</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-center">
                <p className="text-sm opacity-70">USDC Balance</p>
                <p className="text-2xl">${data?.usdcBalance?.toFixed(2) || '0.00'}</p>
              </div>
              <div className="text-center">
                <p className="text-sm opacity-70">Tokens Staked</p>
                <p className="text-2xl">{data?.winnings?.toFixed(2) || '0.00'}</p>
              </div>             
            </div>
            
            <div className="flex gap-2 justify-center mt-4">
              <button 
                onClick={handleDeposit}
                className="btn btn-ghost btn-sm hover:btn-primary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Deposit
              </button>
              <button 
                onClick={handleWithdraw}
                className="btn btn-ghost btn-sm hover:btn-primary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mr-1">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 19.5v-15m0 0l-6.75 6.75M12 4.5l6.75 6.75" />
                </svg>
                Withdraw
              </button>
            </div>
          </div>
        </div>
      );
  }

function AIConfigModal({ 
    isOpen, 
    onClose, 
    address,
    assistant,
    onSubmit 
  }: { 
    isOpen: boolean; 
    onClose: () => void; 
    address: string;
    assistant?: AssistantResponse | null;
    onSubmit: (formData: AIConfigFormData) => void;
  }) {
    return (
      <Dialog 
        open={isOpen} 
        onClose={onClose}
        className="relative z-50"
      >
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-2xl">
            <AIConfigForm 
              address={address} 
              onClose={onClose}
              assistant={assistant}
              onSubmit={onSubmit}
            />
          </Dialog.Panel>
        </div>
      </Dialog>
    );
  }

  interface AIConfigFormData {
    modelName: string;
    alias: string;
    apiType: string;
    apiUrl: string;
    apiKey?: string;
    systemMsg: string;
    params?: {[key: string]: any};
  }
  
  
  // Update the AIConfigForm props as well
  function AIConfigForm({ 
    address, 
    onClose,
    assistant,
    onSubmit 
  }: { 
    address: string; 
    onClose: () => void;
    assistant?: AssistantResponse | null;
    onSubmit: (formData: AIConfigFormData) => void;
  }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [formData, setFormData] = useState<AIConfigFormData>(() => {
      // Initialize form with assistant data if editing
      if (assistant) {
        return {
          modelName: assistant.assistant.modelName,
          alias: assistant.participant.alias || '',
          apiType: assistant.assistant.apiType,
          apiUrl: assistant.assistant.apiUrl,
          systemMsg: assistant.assistant.systemMsg,
          params: assistant.assistant.params || {
            temperature: 0.7,
            max_tokens: 64
          }
        };
      }
      // Default values for new assistant
      return {
        modelName: '',
        alias: '',
        apiType: 'openai',
        apiUrl: '',
        apiKey: '',
        systemMsg: 'You are participating in a Turing test...',
        params: {
          temperature: 0.7,
          max_tokens: 64
        }
      };
    });
  
    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      
      onSubmit(formData);
      
      // Close the modal after submission
      setIsSubmitting(false);
      onClose();
    };
  
    return (
      <div className="card bg-base-200 p-6">
        <h2 className="text-xl font-semibold mb-4">
          {assistant ? 'Edit AI Agent' : 'Configure AI Agent'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">
              <span className="label-text">Model Name</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.modelName}
              onChange={(e) => setFormData({...formData, modelName: e.target.value})}
              placeholder="e.g., gpt-4"
              required
            />
          </div>
  
          <div>
            <label className="label">
              <span className="label-text">Alias (Optional)</span>
            </label>
            <input
              type="text"
              className="input input-bordered w-full"
              value={formData.alias}
              onChange={(e) => setFormData({...formData, alias: e.target.value})}
              placeholder="Give your agent a name"
            />
          </div>
  
          <div>
            <label className="label">
              <span className="label-text">API Type</span>
            </label>
            <select 
              className="select select-bordered w-full"
              value={formData.apiType}
              onChange={(e) => setFormData({...formData, apiType: e.target.value})}
              required
            >
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="custom">Custom</option>
            </select>
          </div>
  
          <div>
            <label className="label">
              <span className="label-text">API URL</span>
            </label>
            <input
              type="url"
              className="input input-bordered w-full"
              value={formData.apiUrl}
              onChange={(e) => setFormData({...formData, apiUrl: e.target.value})}
              placeholder="API endpoint URL"
              required
            />
          </div>
  
          <div>
            <label className="label">
              <span className="label-text">API Key</span>
            </label>
            <input
              type="password"
              className="input input-bordered w-full"
              value={formData.apiKey || ''}
              onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
              placeholder={assistant ? '(unchanged)' : 'Enter API key'}
            //   required={!assistant}
            />
          </div>
  
          <div>
            <label className="label">
              <span className="label-text">System Message</span>
            </label>
            <textarea
              className="textarea textarea-bordered w-full"
              value={formData.systemMsg}
              onChange={(e) => setFormData({...formData, systemMsg: e.target.value})}
              placeholder="Enter the system message for your AI"
              rows={3}
              required
            />
          </div>
  
          <div className="flex justify-end space-x-2">
            <button 
              type="button" 
              className="btn btn-ghost"
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting 
                ? (assistant ? 'Updating...' : 'Creating...') 
                : (assistant ? 'Update Agent' : 'Create Agent')
              }
            </button>
          </div>
        </form>
      </div>
    );
  }

  export function AIProfile({ data, isLoading, address }: { 
    data: AssistantResponse[], 
    isLoading: boolean, 
    address: string 
  }) {
    const socket = useSocket();
    const [showModal, setShowModal] = useState(false);
    const [editingAssistant, setEditingAssistant] = useState<AssistantResponse | null>(null);
    const [localData, setLocalData] = useState<AssistantResponse[]>(data);
  
    const handleEditClick = (assistant: AssistantResponse) => {
        setEditingAssistant(assistant);
        setShowModal(true); // Open modal when editing
      };
    // Debug initial data
    useEffect(() => {
      console.log('Initial data:', data);
      setLocalData(data);
    }, [data]);
  
    // Debug localData changes
    useEffect(() => {
      console.log('LocalData updated:', localData);
    }, [localData]);

    useEffect(() => {
        if (!socket) return;
    
        const handleParticipantUpdated = (response: { 
          success: boolean, 
          data?: {
            participant: Participant;
            assistant: Assistant;
          }
        }) => {
          console.log('Received participant_updated response:', response);
          
          if (response.success && response.data) {  // Type guard
            const { participant, assistant } = response.data;  // Destructure after check
            setLocalData(prev => prev.map(item => 
              item.assistant.id === assistant.id  // Now TypeScript knows this is safe
                ? {
                    assistant,
                    participant
                  }
                : item
            ));
            setShowModal(false);
          } else {
            console.error('Failed to update participant:', response);
            // Optionally show an error message to the user
            alert('Failed to update AI agent configuration');
          }
        };
    
        socket.on('participant_updated', handleParticipantUpdated);
    
        return () => {
          socket.off('participant_updated', handleParticipantUpdated);
        };
      }, [socket]);
    
    const handleStatusToggle = (assistantResponse: AssistantResponse) => {
    if (!socket) {
        console.error('No socket connection available');
        return;
    }
    
    const newStatus = assistantResponse.participant.status === 'active' ? 'inactive' : 'active';
    
    const payload = {
        participant: {
        ...assistantResponse.participant,
        status: newStatus,
        },
        assistant: assistantResponse.assistant
    };
    
    console.log('Toggling status:', payload);
    socket.emit('edit_participant', payload);
    };
  
    useEffect(() => {
      if (!socket) return;
  
      const handleAssistantCreated = (response: { 
        success: boolean, 
        data?: {
          assistant: Assistant;
          participant: Participant;
        }
      }) => {
        console.log('Received assistant_created response:', response);
        
        if (response.success && response.data) {
          const newAssistant: AssistantResponse = {
            assistant: response.data.assistant,
            participant: response.data.participant
          };
          console.log('Created new assistant object:', newAssistant);
          
          setLocalData(prev => {
            console.log('Previous localData:', prev);
            const updated = [...prev, newAssistant];
            console.log('Updated localData will be:', updated);
            return updated;
          });
          
          setShowModal(false);
        }
      };
  
      console.log('Setting up assistant_created listener');
      socket.on('assistant_created', handleAssistantCreated);
  
      return () => {
        console.log('Cleaning up assistant_created listener');
        socket.off('assistant_created', handleAssistantCreated);
      };
    }, [socket]);
  
    const handleCreateAssistant = (formData: AIConfigFormData) => {
        if (!socket) {
          console.error('No socket connection available');
          return;
        }
    
        if (editingAssistant) {
          // Handle edit
          const payload = {
            participant: {
              ...editingAssistant.participant,
              alias: formData.alias,
            },
            assistant: {
              ...editingAssistant.assistant,
              modelName: formData.modelName,
              apiType: formData.apiType,
              apiUrl: formData.apiUrl,
              systemMsg: formData.systemMsg,
              params: formData.params,
              ...(formData.apiKey && { apiKey: formData.apiKey })
            }
          };
    
          console.log('Emitting edit_participant with payload:', payload);
          socket.emit('edit_participant', payload);
        } else {
          // Handle create (existing code)
          const payload = {
            address,
            alias: formData.alias,
            assistantData: formData
          };
    
          console.log('Emitting create_assistant with payload:', payload);
          socket.emit('create_assistant', payload);
        }
      };
  
    const handleDeleteAssistant = (assistantId: string) => {
      if (!socket) {
        console.error('No socket connection available');
        return;
      }

      if (window.confirm('Are you sure you want to delete this AI agent?')) {
        console.log('Deleting assistant:', assistantId);
        
        socket.emit('delete_assistant', { 
          address, 
          assistantId 
        });
        
        socket.once('assistant_deleted', (response: { success: boolean, error?: string }) => {
          if (response.success) {
            console.log('Assistant deleted successfully');
            // Immediately remove the assistant from local state
            setLocalData(prev => prev.filter(a => a.assistant.id !== assistantId));
            // Also refresh the full data
            socket.emit('fetch_participants', { address });
          } else {
            console.error('Failed to delete assistant:', response.error);
            alert(response.error || 'Failed to delete assistant');
          }
        });
      }
    };
  
    return (
      <div className="space-y-6">
        {/* Add New Agent Button */}
        <div className="flex justify-end">
          <button 
            className="btn btn-primary"
            onClick={() => {
                setEditingAssistant(null); // Clear any existing assistant
                setShowModal(true);
              }}          >
            Add New AI Agent
          </button>
        </div>
  
        {/* List of AI Agents */}
        {localData && localData.length > 0 ? (
          localData.map((assistantResponse) => (
            <div key={assistantResponse.assistant.id} className="card bg-base-200 shadow-xl">
              <div className="card-body">
                {/* Header with Name and Status */}
                <div className="flex justify-between items-center mb-4">
                  <h2 className="card-title">
                    {assistantResponse.participant.alias || assistantResponse.assistant.modelName}
                  </h2>
                  <div className="flex items-center gap-2">
                  <button 
                    className={`btn btn-ghost btn-sm hover:btn-primary ${
                        assistantResponse.participant.status === 'active' 
                        ? 'text-success' 
                        : 'text-base-content/70'
                    }`}
                    onClick={() => handleStatusToggle(assistantResponse)}
                    title={`Click to ${assistantResponse.participant.status === 'active' ? 'deactivate' : 'activate'}`}
                    >
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${
                        assistantResponse.participant.status === 'active' 
                            ? 'bg-success' 
                            : 'bg-base-content/30'
                        }`} />
                        {assistantResponse.participant.status}
                    </div>
                    </button>
                    
                    {/* Action Buttons */}
                    <button 
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleEditClick(assistantResponse)} // Use new handler
                        title="Edit Agent"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                      </svg>
                    </button>
                    <button 
                      className="btn btn-ghost btn-sm text-error"
                      onClick={() => handleDeleteAssistant(assistantResponse.assistant.id)}
                      title="Delete Agent"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
  
                {/* Configuration Details */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm opacity-70">Model Name</p>
                    <p className="text-xl">{assistantResponse.assistant.modelName}</p>
                  </div>
                  <div>
                    <p className="text-sm opacity-70">API Type</p>
                    <p className="text-xl">{assistantResponse.assistant.apiType}</p>
                  </div>
                </div>
  
                {/* System Message */}
                <div className="mb-4">
                  <p className="text-sm opacity-70">System Message</p>
                  <p className="whitespace-pre-wrap">
                    {assistantResponse.assistant.systemMsg}
                  </p>
                </div>
  
                {/* Performance Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm opacity-70">Games Played</p>
                    <p className="text-2xl">{assistantResponse.participant.gamesPlayed}</p>
                  </div>
                  <div>
                    <p className="text-sm opacity-70">Wins</p>
                    <p className="text-2xl">{assistantResponse.participant.wins}</p>
                  </div>
                  <div>
                    <p className="text-sm opacity-70">Win Rate</p>
                    <p className="text-2xl">
                      {assistantResponse.participant.gamesPlayed > 0
                        ? `${((assistantResponse.participant.wins / assistantResponse.participant.gamesPlayed) * 100).toFixed(1)}%`
                        : '0%'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm opacity-70">ELO Rating</p>
                    <p className="text-2xl">{assistantResponse.participant.elo}</p>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="card bg-base-200 p-6">
            <h2 className="text-xl font-semibold mb-4">No AI Agents Configured</h2>
            <p className="mb-4">You haven't set up any AI Agents yet.</p>
          </div>
        )}
  
      <AIConfigModal 
        isOpen={showModal}
        onClose={() => {
          setShowModal(false);
          setEditingAssistant(null);
        }}
        address={address}
        assistant={editingAssistant}
        onSubmit={handleCreateAssistant}
      />
    </div>
    );
  }