import path from 'path'
import { isDirectory2, isFile2 } from 'common/filesystem'
import type { RecentDocument } from './recentDocuments'
import type { IUserPreferences } from '@shared/types/preferences'

// The startup folder is a first-use fallback, not a fixed directory for every Ctrl+O.
export function getFileOpenDirectory(
  documents: readonly RecentDocument[],
  preferences: Pick<IUserPreferences, 'startUpAction' | 'defaultDirectoryToOpen'>
): string | undefined {
  const recentFile = documents.find(document => !document.isDirectory && isFile2(document.pathname))
  if (recentFile) return path.dirname(recentFile.pathname)
  const configured = preferences.defaultDirectoryToOpen
  if (preferences.startUpAction === 'folder' && configured && isDirectory2(configured)) return configured
  return undefined
}

export function getFolderOpenDirectory(
  preferences: Pick<IUserPreferences, 'lastOpenedFolder' | 'startUpAction' | 'defaultDirectoryToOpen'>
): string | undefined {
  const remembered = preferences.lastOpenedFolder
  if (remembered && isDirectory2(remembered)) return remembered
  const configured = preferences.defaultDirectoryToOpen
  if (preferences.startUpAction === 'folder' && configured && isDirectory2(configured)) return configured
  return undefined
}
