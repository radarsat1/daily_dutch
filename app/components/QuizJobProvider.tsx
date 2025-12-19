"use client";

import { supabase } from '@/utils/supabase'
import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type JobStatus = "processing" | "completed" | "error";

interface PollResponseItem {
  thread_id: string;
  status: JobStatus;
  result?: any; // The quiz content if ready
  error?: string;
}

interface QuizJobContextType {
  activeThreadCount: number;
  trackJob: (threadId: string) => void;
}

const QuizJobContext = createContext<QuizJobContextType | undefined>(undefined);

export function QuizJobProvider({ children }: { children: React.ReactNode }) {
  const [threads, setThreads] = useState<string[]>([]);
  const router = useRouter();

  // Ref to track if a poll is currently 'in flight' to prevent overlapping calls
  const isPollingRef = useRef(false);

  // Add a new thread to be tracked
  const trackJob = (threadId: string) => {
    setThreads((prev) => {
      if (prev.includes(threadId)) return prev;
      return [...prev, threadId];
    });
  };

  useEffect(() => {
    // 1. If no threads, do nothing (idle state)
    if (threads.length === 0) return;

    // 2. Define the polling function
    const pollJobs = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        console.log("Polling threads:", threads);

        // Ccontinue the graph for all threads.
        const { data, error } = await supabase.functions.invoke('generate-quiz', {
          body: { thread_ids: threads }
        })

        if (error) throw new Error("Poll failed");

        const results: PollResponseItem[] = data.data;

        // 3. Determine which threads are finished
        const finishedIds: string[] = [];
        let hasSuccess = false;

        for (const job of results) {
          if (job.status === "completed" || job.status === "error") {
            finishedIds.push(job.thread_id);

            if (job.status === "completed") {
                hasSuccess = true;
                console.log("Quiz Ready:", job.result);
                // Optional: Trigger a Toast notification here
            }
          }
        };

        // 4. Update State: Remove finished threads
        if (finishedIds.length > 0) {
          setThreads((prev) => prev.filter((id) => !finishedIds.includes(id)));

          // 5. MAGIC: Refresh Server Components
          // If we had a success, tell Next.js to re-fetch server data
          // (i.e. your QuizList component will re-render with the new row from DB)
          if (hasSuccess) {
            router.refresh();
          }
        }

      } catch (err) {
        console.error("Polling error:", err);
      } finally {
        isPollingRef.current = false;
      }
    };

    // 3. Set up the Interval
    // Poll every 3 seconds
    const intervalId = setInterval(pollJobs, 3000);

    // Run immediately on first add so we don't wait 3s for the first check
    pollJobs();

    // Cleanup
    return () => clearInterval(intervalId);
  }, [threads, router]);

  return (
    <QuizJobContext.Provider value={{ activeThreadCount: threads.length, trackJob }}>
      {children}
    </QuizJobContext.Provider>
  );
}

// Custom Hook for consumption
export function useQuizJob() {
  const context = useContext(QuizJobContext);
  if (!context) {
    throw new Error("useQuizJob must be used within a QuizJobProvider");
  }
  return context;
}
