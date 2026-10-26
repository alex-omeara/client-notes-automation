export type AppStatus = 'ready' | 'processing' | 'success' | 'error';
export type OutputMode = 'google-sheet' | 'downloads';

type WorkflowUiOptions = {
  status: AppStatus;
  videoId: string;
  outputMode: OutputMode;
  sheetsLoading: boolean;
  spreadsheetName: string;
  sheetName: string;
};

export function getWorkflowUiState({
  status,
  videoId,
  outputMode,
  sheetsLoading,
  spreadsheetName,
  sheetName,
}: WorkflowUiOptions): { isProcessing: boolean; showControls: boolean; generateDisabled: boolean } {
  const isProcessing = status === 'processing';
  const missingSheetSelection = outputMode === 'google-sheet'
    && (sheetsLoading || !spreadsheetName || !sheetName);

  return {
    isProcessing,
    showControls: !isProcessing,
    generateDisabled: isProcessing || !videoId || missingSheetSelection,
  };
}
