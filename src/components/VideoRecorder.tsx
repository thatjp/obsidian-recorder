import { useState, useRef, useEffect } from 'react';
import { useApp } from '../hooks/useAppContext';
import { MarkdownView, Notice } from 'obsidian';

interface VideoRecorderProps {
	onClose: () => void;
}

export const VideoRecorder = ({ onClose }: VideoRecorderProps) => {
	const app = useApp();
	const videoRef = useRef<HTMLVideoElement>(null);
	const [stream, setStream] = useState<MediaStream | null>(null);
	const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
	const [isRecording, setIsRecording] = useState(false);
	const [recordingDuration, setRecordingDuration] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [isProcessing, setIsProcessing] = useState(false);
	const durationIntervalRef = useRef<number | null>(null);
	const startTimeRef = useRef<number | null>(null);

	// Request camera and microphone access
	useEffect(() => {
		const initializeCamera = async () => {
			try {
				if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
					setError('Your browser does not support video recording. Please use a modern browser.');
					return;
				}

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
      });
      
      console.log('Permission granted, stream obtained:', mediaStream);

				setStream(mediaStream);
				setError(null);
			} catch (err) {
				console.error('Error accessing camera/microphone:', err);
				if (err instanceof Error) {
					if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
						setError('Camera and microphone access was denied. Please allow access and try again.');
					} else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
						setError('No camera or microphone found. Please connect a device and try again.');
					} else {
						setError(`Error accessing camera/microphone: ${err.message}`);
					}
				} else {
					setError('Unknown error accessing camera/microphone.');
				}
			}
		};

		initializeCamera();

		// Cleanup function
		return () => {
			if (durationIntervalRef.current) {
				clearInterval(durationIntervalRef.current);
			}
		};
	}, []);

	// Update video element when stream is available
	useEffect(() => {
		if (stream && videoRef.current) {
			videoRef.current.srcObject = stream;
			// Ensure video starts playing - required for MediaRecorder to capture
			// AbortError is harmless and can be ignored
			videoRef.current.play().catch(err => {
				if (err.name !== 'AbortError') {
					console.error('Error playing video:', err);
				}
			});
		}
	}, [stream]);

	// Cleanup stream on unmount
	useEffect(() => {
		return () => {
			if (stream) {
				stream.getTracks().forEach(track => track.stop());
			}
		};
	}, [stream]);

	const startRecording = () => {
		if (!stream || !app) {
			setError('Stream or app not available');
			return;
		}

		try {
			// Check for supported MIME types
			let mimeType = 'video/webm';
			if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
				mimeType = 'video/webm;codecs=vp9,opus';
			} else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
				mimeType = 'video/webm;codecs=vp8,opus';
			} else if (!MediaRecorder.isTypeSupported('video/webm')) {
				setError('Your browser does not support video recording in WebM format.');
				return;
			}

			const recorder = new MediaRecorder(stream, {
				mimeType: mimeType,
				videoBitsPerSecond: 2500000, // 2.5 Mbps
			});

      console.log('recorder', recorder);
			const chunks: Blob[] = [];
			recorder.ondataavailable = (event) => {
        console.log('event', event);
        
				if (event.data.size > 0) {
					chunks.push(event.data);
				}
			};

			recorder.onstop = async () => {
				setIsProcessing(true);
				await saveVideo(chunks);
			};

			recorder.onerror = (event) => {
				console.error('MediaRecorder error:', event);
				setError('An error occurred during recording.');
				setIsRecording(false);
				if (durationIntervalRef.current) {
					clearInterval(durationIntervalRef.current);
				}
			};

			recorder.start(1000); // Collect data every second
			setMediaRecorder(recorder);
			setIsRecording(true);
			setRecordingDuration(0);
			startTimeRef.current = Date.now();

			// Update duration every second
			durationIntervalRef.current = window.setInterval(() => {
				if (startTimeRef.current) {
					setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
				}
			}, 1000);
		} catch (err) {
			console.error('Error starting recording:', err);
			setError(err instanceof Error ? err.message : 'Failed to start recording');
		}
	};

	const stopRecording = () => {
		if (mediaRecorder && isRecording) {
			mediaRecorder.stop();
			setIsRecording(false);
			if (durationIntervalRef.current) {
				clearInterval(durationIntervalRef.current);
				durationIntervalRef.current = null;
			}
		}
	};

	const formatDuration = (seconds: number): string => {
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
	};

	const saveVideo = async (chunks: Blob[]) => {
		if (!app) {
			setError('App not available');
			setIsProcessing(false);
			return;
		}

		try {
			// Combine chunks into a single blob
			const videoBlob = new Blob(chunks, { type: 'video/webm' });
			const arrayBuffer = await videoBlob.arrayBuffer();

			// Generate filename with timestamp
			const now = new Date();
			const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
			const filename = `recording-${timestamp}.webm`;

			// Get the active note to determine where to save
			const activeView = app.workspace.getActiveViewOfType(MarkdownView);
			let savePath: string;

			if (activeView?.file) {
				// Save in the same folder as the active note
				const filePath = activeView.file.path;
				const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));
				savePath = folderPath ? `${folderPath}/${filename}` : filename;
			} else {
				// Save in vault root
				savePath = filename;
			}

			// Save the video file
			await app.vault.adapter.writeBinary(savePath, arrayBuffer);

			// Insert markdown link into the active note
			if (activeView) {
				const editor = activeView.editor;
				const markdownLink = `![Video recording](${savePath})\n`;
				editor.replaceSelection(markdownLink);
				new Notice('Video saved and inserted into note!');
			} else {
				new Notice(`Video saved to: ${savePath}`);
			}

			// Close the modal
			onClose();
		} catch (err) {
			console.error('Error saving video:', err);
			setError(err instanceof Error ? err.message : 'Failed to save video');
			setIsProcessing(false);
		}
	};

	const handleCancel = () => {
		if (isRecording) {
			stopRecording();
		}
		if (stream) {
			stream.getTracks().forEach(track => track.stop());
		}
		onClose();
	};

	return (
		<div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
			<h2 style={{ margin: '0 0 10px 0' }}>Video Recorder</h2>

			{error && (
				<div style={{
					padding: '10px',
					backgroundColor: '#ff4444',
					color: 'white',
					borderRadius: '4px',
					marginBottom: '10px'
				}}>
					{error}
				</div>
			)}

			{!stream && !error && (
				<div style={{ textAlign: 'center', padding: '20px' }}>
					Requesting camera access...
				</div>
			)}

			{stream && (
				<>
					<div style={{
						position: 'relative',
						width: '100%',
						maxWidth: '640px',
						margin: '0 auto',
						backgroundColor: '#000',
						borderRadius: '8px',
						overflow: 'hidden'
					}}>
						<video
							ref={videoRef}
							autoPlay
							playsInline
							muted
							style={{
								width: '100%',
								height: 'auto',
								display: 'block'
							}}
						/>
						{isRecording && (
							<div style={{
								position: 'absolute',
								top: '10px',
								left: '10px',
								backgroundColor: 'rgba(255, 0, 0, 0.8)',
								color: 'white',
								padding: '5px 10px',
								borderRadius: '4px',
								fontSize: '14px',
								fontWeight: 'bold',
								display: 'flex',
								alignItems: 'center',
								gap: '5px'
							}}>
								<div 
									className="video-recorder-pulse"
									style={{
										width: '10px',
										height: '10px',
										backgroundColor: 'white',
										borderRadius: '50%'
									}} 
								/>
								REC {formatDuration(recordingDuration)}
							</div>
						)}
					</div>

					<div style={{
						display: 'flex',
						justifyContent: 'center',
						gap: '10px',
						marginTop: '10px'
					}}>
						{!isRecording ? (
							<button
								onClick={startRecording}
								disabled={isProcessing}
								style={{
									padding: '10px 20px',
									fontSize: '16px',
									backgroundColor: '#4CAF50',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: isProcessing ? 'not-allowed' : 'pointer',
									fontWeight: 'bold'
								}}
							>
								Start Recording
							</button>
						) : (
							<button
								onClick={stopRecording}
								disabled={isProcessing}
								style={{
									padding: '10px 20px',
									fontSize: '16px',
									backgroundColor: '#f44336',
									color: 'white',
									border: 'none',
									borderRadius: '4px',
									cursor: isProcessing ? 'not-allowed' : 'pointer',
									fontWeight: 'bold'
								}}
							>
								Stop Recording
							</button>
						)}
						<button
							onClick={handleCancel}
							disabled={isProcessing}
							style={{
								padding: '10px 20px',
								fontSize: '16px',
								backgroundColor: '#666',
								color: 'white',
								border: 'none',
								borderRadius: '4px',
								cursor: isProcessing ? 'not-allowed' : 'pointer'
							}}
						>
							Cancel
						</button>
					</div>

					{isProcessing && (
						<div style={{
							textAlign: 'center',
							padding: '10px',
							color: '#666'
						}}>
							Saving video...
						</div>
					)}
				</>
			)}
		</div>
	);
};

