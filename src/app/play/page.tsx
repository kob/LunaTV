/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

/// <reference types="@webgpu/types" />

'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type shaka from 'shaka-player';
import { Heart, ChevronUp, Download, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import Hls from 'hls.js';

import { useDownload } from '@/contexts/DownloadContext';
import DownloadEpisodeSelector from '@/components/download/DownloadEpisodeSelector';
import EpisodeSelector from '@/components/EpisodeSelector';
import NetDiskSearchResults from '@/components/NetDiskSearchResults';
import AcgSearch from '@/components/AcgSearch';
import PageLayout from '@/components/PageLayout';
import SkipController, { SkipSettingsButton } from '@/components/SkipController';
import VideoCard from '@/components/VideoCard';
import CommentSection from '@/components/play/CommentSection';
import DownloadButtons from '@/components/play/DownloadButtons';
import FavoriteButton from '@/components/play/FavoriteButton';
import NetDiskButton from '@/components/play/NetDiskButton';
import CollapseButton from '@/components/play/CollapseButton';
import BackToTopButton from '@/components/play/BackToTopButton';
import LoadingScreen from '@/components/play/LoadingScreen';
import VideoLoadingOverlay from '@/components/play/VideoLoadingOverlay';
import WatchRoomSyncBanner from '@/components/play/WatchRoomSyncBanner';
import SourceSwitchDialog from '@/components/play/SourceSwitchDialog';
import OwnerChangeDialog from '@/components/play/OwnerChangeDialog';
import VideoCoverDisplay from '@/components/play/VideoCoverDisplay';
import PlayErrorDisplay from '@/components/play/PlayErrorDisplay';
import WebSRSettingsPanel from '@/components/play/WebSRSettingsPanel';
import { ClientCache } from '@/lib/client-cache';
import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  getAllFavorites,
  getAllPlayRecords,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanDetails, getDoubanComments, getDoubanActorMovies } from '@/lib/douban.client';
import { SearchResult } from '@/lib/types';
import { getVideoResolutionFromM3u8, processImageUrl } from '@/lib/utils';
import { useWatchRoomContextSafe } from '@/components/WatchRoomProvider';
import { useWatchRoomSync } from './hooks/useWatchRoomSync';
import {
  useSavePlayRecordMutation,
  useSaveFavoriteMutation,
  useDeleteFavoriteMutation,
} from './hooks/usePlayPageMutations';
import {
  useDoubanDetailsQuery,
  useDoubanCommentsQuery,
} from './hooks/usePlayPageQueries';
import {
  usePrefetchNextEpisode,
  usePrefetchDoubanData,
} from './hooks/usePlayPagePrefetch';

declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { createTask, setShowDownloadPanel } = useDownload();
  const watchRoom = useWatchRoomContextSafe();

  const savePlayRecordMutation = useSavePlayRecordMutation();
  const saveFavoriteMutation = useSaveFavoriteMutation();
  const deleteFavoriteMutation = useDeleteFavoriteMutation();

  // State variables
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('Searching for playback sources...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  const [speedTestProgress, setSpeedTestProgress] = useState<{
    current: number;
    total: number;
    currentSource: string;
    result?: string;
  } | null>(null);

  const [favorited, setFavorited] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const [bangumiDetails, setBangumiDetails] = useState<any>(null);
  const [loadingBangumiDetails, setLoadingBangumiDetails] = useState(false);

  const [shortdramaDetails, setShortdramaDetails] = useState<any>(null);
  const [loadingShortdramaDetails, setLoadingShortdramaDetails] = useState(false);

  const [netdiskResults, setNetdiskResults] = useState<{ [key: string]: any[] } | null>(null);
  const [netdiskLoading, setNetdiskLoading] = useState(false);
  const [netdiskError, setNetdiskError] = useState<string | null>(null);
  const [netdiskTotal, setNetdiskTotal] = useState(0);
  const [showNetdiskModal, setShowNetdiskModal] = useState(false);
  const [netdiskResourceType, setNetdiskResourceType] = useState<'netdisk' | 'acg'>('netdisk');

  const [acgTriggerSearch, setAcgTriggerSearch] = useState<boolean>();

  const [selectedCelebrityName, setSelectedCelebrityName] = useState<string | null>(null);
  const [celebrityWorks, setCelebrityWorks] = useState<any[]>([]);
  const [loadingCelebrityWorks, setLoadingCelebrityWorks] = useState(false);

  const [isSkipSettingOpen, setIsSkipSettingOpen] = useState(false);
  const [currentPlayTime, setCurrentPlayTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

  const [isWebSRSettingsPanelOpen, setIsWebSRSettingsPanelOpen] = useState(false);

  const [showDownloadEpisodeSelector, setShowDownloadEpisodeSelector] = useState(false);

  const [downloadEnabled, setDownloadEnabled] = useState(true);

  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(null);

  const isDraggingProgressRef = useRef(false);
  const seekResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resizeResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);

  const [customAdFilterCode, setCustomAdFilterCode] = useState<string>('');
  const [customAdFilterVersion, setCustomAdFilterVersion] = useState<number>(1);
  const customAdFilterCodeRef = useRef(customAdFilterCode);

  const [webGPUSupported, setWebGPUSupported] = useState<boolean>(false);
  const [websrEnabled, setWebsrEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('websr_enabled') === 'true';
    }
    return false;
  });
  const [websrMode, setWebsrMode] = useState<'upscale' | 'restore'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('websr_mode');
      if (v === 'restore') return 'restore';
    }
    return 'upscale';
  });
  const [websrContentType, setWebsrContentType] = useState<'an' | 'rl' | '3d'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('websr_content_type');
      if (v === 'rl' || v === '3d') return v;
    }
    return 'an';
  });
  const [websrNetworkSize, setWebsrNetworkSize] = useState<'s' | 'm' | 'l'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('websr_network_size');
      if (v === 'm' || v === 'l') return v;
    }
    return 's';
  });
  const [websrCompareEnabled, setWebsrCompareEnabled] = useState(false);
  const [websrComparePosition, setWebsrComparePosition] = useState(50);

  const websrRef = useRef<{
    instance: any;
    gpu: GPUDevice | null;
    canvas: HTMLCanvasElement | null;
    weightsCache: Map<string, any>;
    isActive: boolean;
    renderLoopActive: boolean;
  }>({
    instance: null,
    gpu: null,
    canvas: null,
    weightsCache: new Map(),
    isActive: false,
    renderLoopActive: false,
  });

  const websrEnabledRef = useRef(websrEnabled);
  const websrModeRef = useRef(websrMode);
  const websrContentTypeRef = useRef(websrContentType);
  const websrNetworkSizeRef = useRef(websrNetworkSize);
  const netdiskModalContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchServerConfig = async () => {
      try {
        const response = await fetch('/api/server-config');
        if (response.ok) {
          const config = await response.json();
          setDownloadEnabled(config.DownloadEnabled ?? true);
        }
      } catch (error) {
        console.error('Failed to fetch server config:', error);
        setDownloadEnabled(true);
      }
    };
    fetchServerConfig();
  }, []);

  useEffect(() => {
    websrEnabledRef.current = websrEnabled;
    websrModeRef.current = websrMode;
    websrContentTypeRef.current = websrContentType;
    websrNetworkSizeRef.current = websrNetworkSize;
  }, [websrEnabled, websrMode, websrContentType, websrNetworkSize]);

  // Get HLS buffer configuration (based on user mode)
  const getHlsBufferConfig = () => {
    const mode =
      typeof window !== 'undefined'
        ? localStorage.getItem('playerBufferMode') || 'standard'
        : 'standard';

    switch (mode) {
      case 'enhanced':
        return {
          maxBufferLength: 45,
          backBufferLength: 45,
          maxBufferSize: 90 * 1000 * 1000,
        };
      case 'max':
        return {
          maxBufferLength: 90,
          backBufferLength: 60,
          maxBufferSize: 180 * 1000 * 1000,
        };
      case 'standard':
      default:
        return {
          maxBufferLength: 30,
          backBufferLength: 30,
          maxBufferSize: 60 * 1000 * 1000,
        };
    }
  };

  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(
    parseInt(searchParams.get('douban_id') || '0') || 0
  );

  const {
    data: movieDetails,
    status: movieDetailsStatus,
    error: movieDetailsError,
  } = useDoubanDetailsQuery(videoDoubanId);

  const {
    data: movieComments,
    status: commentsStatus,
    error: commentsError,
  } = useDoubanCommentsQuery(videoDoubanId);

  const loadingMovieDetails = movieDetailsStatus === 'pending';
  const loadingComments = commentsStatus === 'pending';

  // Placeholder for remaining component logic
  return (
    <PageLayout>
      <LoadingScreen
        loadingStage={loadingStage}
        loadingMessage={loadingMessage}
        speedTestProgress={speedTestProgress}
      />
      {error && <PlayErrorDisplay error={error} />}
    </PageLayout>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<LoadingScreen loadingStage="searching" loadingMessage="Loading..." />}>
      <PlayPageClient />
    </Suspense>
  );
}
