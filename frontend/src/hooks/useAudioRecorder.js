import { useState, useRef, useCallback } from 'react';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const timer = useRef(null);
  const startTime = useRef(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
      };

      mediaRecorder.current = recorder;
      recorder.start(1000);
      setIsRecording(true);
      setAudioBlob(null);
      setDuration(0);
      startTime.current = Date.now();

      timer.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTime.current) / 1000));
      }, 500);
    } catch (err) {
      console.error('Mic access denied:', err);
      throw new Error('Permissão de microfone negada');
    }
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorder.current?.state === 'recording') {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setDuration(0);
  }, []);

  const formatDuration = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return { isRecording, duration, audioBlob, start, stop, reset, formatDuration: () => formatDuration(duration) };
}
