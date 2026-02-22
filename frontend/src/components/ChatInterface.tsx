'use client';
import { useChat } from '@ai-sdk/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useState } from 'react';

export default function ChatInterface() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();
  const [visualProof, setVisualProof] = useState<string | null>(null);

  return (
    <div className="flex h-screen w-full bg-slate-50 relative overflow-hidden">
      <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto p-4 transition-all duration-300">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-slate-800">Go-Live Buddy</h1>
          <p className="text-slate-500 text-sm">Professional Multi-Tech AI Knowledge Portal</p>
        </header>
        
        <ScrollArea className="flex-1 pr-4 mb-4 border rounded-xl bg-white shadow-sm p-4">
          <div className="flex flex-col gap-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-400 mt-20">
                Ask me about SAP Fiori or Salesforce CRM!
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`px-4 py-2 rounded-xl max-w-[80%] ${m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}`}>
                  {m.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="px-4 py-2 rounded-xl bg-slate-100 text-slate-500 animate-pulse">
                  Buddy is typing...
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input 
            value={input} 
            onChange={handleInputChange} 
            placeholder="How do I navigate Fiori? Or convert a Lead in CRM?" 
            className="flex-1 shadow-sm"
          />
          <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-blue-700 shadow-sm">
            Send
          </Button>
        </form>
      </div>

      <div className="w-80 h-full bg-white border-l shadow-xl p-4 flex flex-col hidden lg:flex">
        <h2 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <span className="text-blue-500">📄</span> Visual Proof
        </h2>
        <Card className="flex-1 bg-slate-50 border-dashed border-2 flex flex-col items-center justify-center p-4 text-center">
          {visualProof ? (
            <div className="w-full h-full object-cover">
              <img src={visualProof} alt="Visual Proof" className="rounded-md object-contain h-full" />
            </div>
          ) : (
            <div className="text-sm text-slate-400">
              Citations and visual proof will appear here when Go-Live Buddy references documentation.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
