/* eslint-disable @typescript-eslint/ban-ts-comment, @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

/// <reference types="@webgpu/types" />

'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
// HLS.js is no longer used; Shaka Player handles HLS/DASH internally
import type shaka from 'shaka-player';
import { Heart, ChevronUp, Download, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

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
import VideoInfoSection from '@/components/play/VideoInfoSection';
import VideoLoadingOverlay from '@/components/play/VideoLoadingOverlay';
import WatchRoomSyncBanner from '@/components/play/WatchRoomSyncBanner';
import SourceSwitchDialog from '@/components/play/SourceSwitchDialog';
import OwnerChangeDialog from '@/components/play/OwnerChangeDialog';
import VideoCoverDisplay from '@/components/play/VideoCoverDisplay';
import PlayErrorDisplay from '@/components/play/PlayErrorDisplay';
import WebSRSettingsPanel from '@/components/play/WebSRSettingsPanel';
// ArtPlayer plugins removed (we'll adapt the UI later if needed)
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

// 鎵╁睍 HTMLVideoElement 绫诲瀷浠ユ敮鎸?hls 灞炴€?declare global {
interface HTMLVideoElement {
  hls?: any;
}
}

// Wake Lock API 绫诲瀷澹版槑
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

  // TanStack Query mutations
  const savePlayRecordMutation = useSavePlayRecordMutation();
  const saveFavoriteMutation = useSaveFavoriteMutation();
  const deleteFavoriteMutation = useDeleteFavoriteMutation();

  // -----------------------------------------------------------------------------
  // 鐘舵€佸彉閲忥紙State锛?  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('姝ｅ湪鎼滅储鎾斁婧?..');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 娴嬮€熻繘搴︾姸鎬?  const [speedTestProgress, setSpeedTestProgress] = useState<{
  current: number;
  total: number;
  currentSource: string;
  result ?: string;
} | null > (null);

// 鏀惰棌鐘舵€?  const [favorited, setFavorited] = useState(false);

// 杩斿洖椤堕儴鎸夐挳鏄剧ず鐘舵€?  const [showBackToTop, setShowBackToTop] = useState(false);

// bangumi璇︽儏鐘舵€?  const [bangumiDetails, setBangumiDetails] = useState<any>(null);
const [loadingBangumiDetails, setLoadingBangumiDetails] = useState(false);

// 鐭墽璇︽儏鐘舵€侊紙鐢ㄤ簬鏄剧ず绠€浠嬬瓑淇℃伅锛?  const [shortdramaDetails, setShortdramaDetails] = useState<any>(null);
const [loadingShortdramaDetails, setLoadingShortdramaDetails] = useState(false);

// 缃戠洏鎼滅储鐘舵€?  const [netdiskResults, setNetdiskResults] = useState<{ [key: string]: any[] } | null>(null);
const [netdiskLoading, setNetdiskLoading] = useState(false);
const [netdiskError, setNetdiskError] = useState<string | null>(null);
const [netdiskTotal, setNetdiskTotal] = useState(0);
const [showNetdiskModal, setShowNetdiskModal] = useState(false);
const [netdiskResourceType, setNetdiskResourceType] = useState<'netdisk' | 'acg'>('netdisk'); // 璧勬簮绫诲瀷

// ACG 鍔ㄦ极纾佸姏鎼滅储鐘舵€?  const [acgTriggerSearch, setAcgTriggerSearch] = useState<boolean>();

// 婕斿憳浣滃搧鐘舵€?  const [selectedCelebrityName, setSelectedCelebrityName] = useState<string | null>(null);
const [celebrityWorks, setCelebrityWorks] = useState<any[]>([]);
const [loadingCelebrityWorks, setLoadingCelebrityWorks] = useState(false);

// SkipController 相关状态
  const [isSkipSettingOpen, setIsSkipSettingOpen] = useState(false);
const [currentPlayTime, setCurrentPlayTime] = useState(0);
const [videoDuration, setVideoDuration] = useState(0);

const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);

// WebSR 璁剧疆闈㈡澘鐘舵€?  const [isWebSRSettingsPanelOpen, setIsWebSRSettingsPanelOpen] = useState(false);

// 涓嬭浇閫夐泦闈㈡澘鐘舵€?  const [showDownloadEpisodeSelector, setShowDownloadEpisodeSelector] = useState(false);

// 涓嬭浇鍔熻兘鍚敤鐘舵€?  const [downloadEnabled, setDownloadEnabled] = useState(true);

// 瑙嗛鍒嗚鲸鐜囩姸鎬?  const [videoResolution, setVideoResolution] = useState<{ width: number; height: number } | null>(null);

// 杩涘害鏉℃嫋鎷界姸鎬佺鐞?  const isDraggingProgressRef = useRef(false);
const seekResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

// resize浜嬩欢闃叉姈绠＄悊
const resizeResetTimeoutRef = useRef<NodeJS.Timeout | null>(null);

// 鍘诲箍鍛婂紑鍏筹紙浠?localStorage 缁ф壙锛岄粯璁?true锛?  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
if (typeof window !== 'undefined') {
  const v = localStorage.getItem('enable_blockad');
  if (v !== null) return v === 'true';
}
return true;
  });
const blockAdEnabledRef = useRef(blockAdEnabled);

// 鑷畾涔夊幓骞垮憡浠ｇ爜
const [customAdFilterCode, setCustomAdFilterCode] = useState<string>('');
const [customAdFilterVersion, setCustomAdFilterVersion] = useState<number>(1);
const customAdFilterCodeRef = useRef(customAdFilterCode);


// WebSR瓒呭垎鐩稿叧鐘舵€?  const [webGPUSupported, setWebGPUSupported] = useState<boolean>(false);
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

// 鑾峰彇鏈嶅姟鍣ㄩ厤缃紙涓嬭浇鍔熻兘寮€鍏筹級
useEffect(() => {
  const fetchServerConfig = async () => {
    try {
      const response = await fetch('/api/server-config');
      if (response.ok) {
        const config = await response.json();
        setDownloadEnabled(config.DownloadEnabled ?? true);
      }
    } catch (error) {
      console.error('鑾峰彇鏈嶅姟鍣ㄩ厤缃け璐?', error);
      // 鍑洪敊鏃堕粯璁ゅ惎鐢ㄤ笅杞藉姛鑳?        setDownloadEnabled(true);
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

// 鑾峰彇 HLS 缂撳啿閰嶇疆锛堟牴鎹敤鎴疯缃殑妯″紡锛?  const getHlsBufferConfig = () => {
const mode =
  typeof window !== 'undefined'
    ? localStorage.getItem('playerBufferMode') || 'standard'
    : 'standard';

switch (mode) {
  case 'enhanced':
    // 澧炲己妯″紡锛?.5 鍊嶇紦鍐?        return {
    maxBufferLength: 45, // 45s锛堥粯璁?0s 脳 1.5锛?          backBufferLength: 45,
      maxBufferSize: 90 * 1000 * 1000, // 90MB
        };
      case 'max':
// 寮哄姏妯″紡锛? 鍊嶇紦鍐?        return {
maxBufferLength: 90, // 90s锛堥粯璁?0s 脳 3锛?          backBufferLength: 60,
  maxBufferSize: 180 * 1000 * 1000, // 180MB
        };
      case 'standard':
      default:
// 榛樿妯″紡
return {
  maxBufferLength: 30,
  backBufferLength: 30,
  maxBufferSize: 60 * 1000 * 1000, // 60MB
};
    }
  };

// 瑙嗛鍩烘湰淇℃伅
const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
const [videoCover, setVideoCover] = useState('');
const [videoDoubanId, setVideoDoubanId] = useState(
  parseInt(searchParams.get('douban_id') || '0') || 0
);

// TanStack Query queries - 璞嗙摚璇︽儏鍜岃瘎璁猴紙渚濊禆 videoDoubanId锛?  const {
data: movieDetails,
  status: movieDetailsStatus,
    error: movieDetailsError,
  } = useDoubanDetailsQuery(videoDoubanId);

const {
  data: movieComments,
  status: commentsStatus,
  error: commentsError,
} = useDoubanCommentsQuery(videoDoubanId);

// 鍏煎鏃т唬鐮佺殑 loading 鐘舵€?  const loadingMovieDetails = movieDetailsStatus === 'pending';
const loadingComments = commentsStatus === 'pending';

// 褰撳墠婧愬拰ID
const [currentSource, setCurrentSource] = useState(
  searchParams.get('source') || ''
);
const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

// 瑙ｆ瀽 source 鍙傛暟浠ヨ幏鍙?embyKey锛堜粎鐢ㄤ簬 API 璋冪敤锛?  const parseSourceForApi = (source: string): { source: string; embyKey?: string } => {
if (source.startsWith('emby_')) {
  const key = source.substring(5);
  return { source: 'emby', embyKey: key };
}
return { source };
  };

// 鐭墽ID锛堢敤浜庤幏鍙栬鎯呮樉绀猴紝涓嶅奖鍝嶆簮鎼滅储锛?  const [shortdramaId] = useState(searchParams.get('shortdrama_id') || '');

// 鎼滅储鎵€闇€淇℃伅
const [searchTitle] = useState(searchParams.get('stitle') || '');
const [searchType] = useState(searchParams.get('stype') || '');

// 鏄惁闇€瑕佷紭閫?  const [needPrefer, setNeedPrefer] = useState(
searchParams.get('prefer') === 'true'
  );
const needPreferRef = useRef(needPrefer);
// 闆嗘暟鐩稿叧
const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(() => {
  // 浠?URL 璇诲彇鍒濆闆嗘暟
  const indexParam = searchParams.get('index');
  return indexParam ? parseInt(indexParam, 10) : 0;
});

// 鐩戝惉 URL index 鍙傛暟鍙樺寲锛堣褰卞鍒囬泦鍚屾锛?  useEffect(() => {
const indexParam = searchParams.get('index');
const newIndex = indexParam ? parseInt(indexParam, 10) : 0;
if (newIndex !== currentEpisodeIndex) {
  console.log('[PlayPage] URL index changed, updating episode:', newIndex);
  setCurrentEpisodeIndex(newIndex);
}
  }, [searchParams]);

// 閲嶆柊鍔犺浇瑙﹀彂鍣紙鐢ㄤ簬瑙﹀彂 initAll 閲嶆柊鎵ц锛?  const [reloadTrigger, setReloadTrigger] = useState(0);
const reloadFlagRef = useRef<string | null>(null);

// 鐩戝惉 URL source/id 鍙傛暟鍙樺寲锛堣褰卞鍒囨崲婧愬悓姝ワ級
useEffect(() => {
  const newSource = searchParams.get('source') || '';
  const newId = searchParams.get('id') || '';
  const newIndex = parseInt(searchParams.get('index') || '0');
  const newTime = parseInt(searchParams.get('t') || '0');
  const reloadFlag = searchParams.get('_reload');

  // 濡傛灉 source 鎴?id 鍙樺寲锛屼笖鏈?_reload 鏍囪锛屼笖涓嶆槸宸茬粡澶勭悊杩囩殑reload
  if (reloadFlag && reloadFlag !== reloadFlagRef.current && (newSource !== currentSource || newId !== currentId)) {
    console.log('[PlayPage] URL source/id changed with reload flag, reloading:', { newSource, newId, newIndex, newTime });

    // 鏍囪姝eload宸插鐞?      reloadFlagRef.current = reloadFlag;

    // 閲嶇疆鎵€鏈夌浉鍏崇姸鎬侊紙浣嗕繚鐣?detail锛岃 initAll 閲嶆柊鍔犺浇鍚庡啀鏇存柊锛?      setCurrentSource(newSource);
    setCurrentId(newId);
    setCurrentEpisodeIndex(newIndex);
    // 涓嶆竻绌?detail锛岄伩鍏嶈Е鍙?videoUrl 娓呯┖瀵艰嚧榛戝睆
    // setDetail(null);
    setError(null);
    setLoading(true);
    setNeedPrefer(false);
    setPlayerReady(false);

    // 瑙﹀彂閲嶆柊鍔犺浇锛堥€氳繃鏇存柊 reloadTrigger 鏉ヨЕ鍙?initAll 閲嶆柊鎵ц锛?      setReloadTrigger(prev => prev + 1);
  }
}, [searchParams, currentSource, currentId]);

// 鎹㈡簮鐩稿叧鐘舵€?  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
const availableSourcesRef = useRef<SearchResult[]>([]);

const currentSourceRef = useRef(currentSource);
const currentIdRef = useRef(currentId);
const videoTitleRef = useRef(videoTitle);
const videoYearRef = useRef(videoYear);
const videoDoubanIdRef = useRef(videoDoubanId);
const detailRef = useRef<SearchResult | null>(detail);
const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

// ArtPlayer compatibility ref (adapter for legacy code)
const artPlayerRef = useRef<any>(null);
const artRef = useRef<HTMLDivElement | null>(null);
// new refs for Shaka migration
const videoRef = useRef<HTMLVideoElement | null>(null);
const shakaPlayerRef = useRef<shaka.Player | null>(null);



// 鉁?鍚堝苟鎵€鏈?ref 鍚屾鐨?useEffect - 鍑忓皯涓嶅繀瑕佺殑娓叉煋
useEffect(() => {
  blockAdEnabledRef.current = blockAdEnabled;
  customAdFilterCodeRef.current = customAdFilterCode;  needPreferRef.current = needPrefer;
  currentSourceRef.current = currentSource;
  currentIdRef.current = currentId;
  detailRef.current = detail;
  currentEpisodeIndexRef.current = currentEpisodeIndex;
  videoTitleRef.current = videoTitle;
  videoYearRef.current = videoYear;
  videoDoubanIdRef.current = videoDoubanId;
  availableSourcesRef.current = availableSources;
}, [
  blockAdEnabled,
  customAdFilterCode,
  needPrefer,
  currentSource,
  currentId,
  detail,
  currentEpisodeIndex,
  videoTitle,
  videoYear,
  videoDoubanId,
  availableSources,
]);

// update fullscreen title overlay (ArtPlayer provided layer)
useEffect(() => {
  const layer = artPlayerRef.current?.layers?.['fullscreen-title'];
  if (!layer || typeof (layer as any).innerHTML === 'undefined') return;

  const episodeName = detail?.episodes_titles?.[currentEpisodeIndex] || '';
  const hasEpisodes = detail?.episodes && detail.episodes.length > 1;

  (layer as any).innerHTML = `
      <div class="fullscreen-title-container">
        <div class="fullscreen-title-content">
          <h1 class="fullscreen-title-text">${detail?.title || ''}</h1>
          ${hasEpisodes && episodeName
      ? `<span class="fullscreen-episode-text">${episodeName}</span>`
      : hasEpisodes
        ? `<span class="fullscreen-episode-text">绗?${currentEpisodeIndex + 1} 闆?/span>`
        : ''}
        </div>
      </div>
    `;
}, [currentEpisodeIndex, detail, portalContainer]);

// 鑾峰彇鑷畾涔夊幓骞垮憡浠ｇ爜
useEffect(() => {
  const fetchAdFilterCode = async () => {
    try {
      // 浠庣紦瀛樿鍙栧幓骞垮憡浠ｇ爜鍜岀増鏈彿
      const cachedCode = localStorage.getItem('customAdFilterCode');
      const cachedVersion = localStorage.getItem('customAdFilterVersion');

      if (cachedCode && cachedVersion) {
        setCustomAdFilterCode(cachedCode);
        setCustomAdFilterVersion(parseInt(cachedVersion));
        console.log('浣跨敤缂撳瓨鐨勫幓骞垮憡浠ｇ爜');
      }

      // 浠?window.RUNTIME_CONFIG 鑾峰彇鐗堟湰鍙?        const version = (window as any).RUNTIME_CONFIG?.CUSTOM_AD_FILTER_VERSION || 0;

      // 濡傛灉鐗堟湰鍙蜂负 0锛岃鏄庡幓骞垮憡鏈缃紝娓呯┖缂撳瓨骞惰烦杩?        if (version === 0) {
      localStorage.removeItem('customAdFilterCode');
      localStorage.removeItem('customAdFilterVersion');
      setCustomAdFilterCode('');
      setCustomAdFilterVersion(0);
      return;
    }

        // 濡傛灉缂撳瓨鐗堟湰鍙蜂笌鏈嶅姟鍣ㄧ増鏈彿涓嶄竴鑷达紝鑾峰彇鏈€鏂颁唬鐮?        if (!cachedVersion || parseInt(cachedVersion) !== version) {
          console.log('妫€娴嬪埌鍘诲箍鍛婁唬鐮佹洿鏂帮紙鐗堟湰 ' + version + '锛夛紝鑾峰彇鏈€鏂颁唬鐮?);

          // 鑾峰彇瀹屾暣浠ｇ爜
          const fullResponse = await fetch('/api/ad-filter?full=true');
    if (!fullResponse.ok) {
      console.warn('鑾峰彇瀹屾暣鍘诲箍鍛婁唬鐮佸け璐ワ紝浣跨敤缂撳瓨');
      return;
    }

    const { code, version: newVersion } = await fullResponse.json();

    // 鏇存柊缂撳瓨鍜岀姸鎬?          localStorage.setItem('customAdFilterCode', code || '');
    localStorage.setItem('customAdFilterVersion', String(newVersion || 0));
    setCustomAdFilterCode(code || '');
    setCustomAdFilterVersion(newVersion || 0);

    console.log('鍘诲箍鍛婁唬鐮佸凡鏇存柊鍒扮増鏈?' + newVersion);
  }
} catch (error) {
  console.error('鑾峰彇鑷畾涔夊幓骞垮憡浠ｇ爜澶辫触:', error);
}
    };

fetchAdFilterCode();
  }, []);

// WebGPU鏀寔妫€娴?  useEffect(() => {
const checkWebGPUSupport = async () => {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    setWebGPUSupported(false);
    console.log('WebGPU涓嶆敮鎸侊細娴忚鍣ㄤ笉鏀寔WebGPU API');
    return;
  }

  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      setWebGPUSupported(false);
      console.log('WebGPU涓嶆敮鎸侊細鏃犳硶鑾峰彇GPU閫傞厤鍣?);
          return;
    }

    setWebGPUSupported(true);
    console.log('WebGPU鏀寔妫€娴嬶細鉁?鏀寔');
  } catch (err) {
    setWebGPUSupported(false);
    console.log('WebGPU涓嶆敮鎸侊細妫€娴嬪け璐?, err);
      }
};

checkWebGPUSupport();
  }, []);

// WebSR 鍚敤/绂佺敤鐢熷懡鍛ㄦ湡
useEffect(() => {
  if (!websrEnabled || !webGPUSupported || !artPlayerRef.current?.video) {
    destroyWebSR();
    return;
  }

  const video = artPlayerRef.current.video as HTMLVideoElement;

  const waitForVideo = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      initWebSR();
    } else {
      const handler = () => {
        video.removeEventListener('loadedmetadata', handler);
        initWebSR();
      };
      video.addEventListener('loadedmetadata', handler);
    }
  };

  waitForVideo();

  return () => {
    destroyWebSR();
  };
}, [websrEnabled, webGPUSupported]);

// WebSR 閰嶇疆鍙樺寲锛堟ā寮?缃戠粶澶у皬/鍐呭绫诲瀷锛?  useEffect(() => {
if (!websrRef.current.isActive) return;
switchWebSRConfig();
  }, [websrMode, websrNetworkSize, websrContentType]);

// WebSR 瀵规瘮妯″紡
useEffect(() => {
  if (!websrRef.current.canvas || !artPlayerRef.current?.video) return;

  const canvas = websrRef.current.canvas;
  const video = artPlayerRef.current.video as HTMLVideoElement;

  if (websrCompareEnabled) {
    canvas.style.clipPath = `inset(0 0 0 ${websrComparePosition}%)`;
    video.style.opacity = '1';
    video.style.clipPath = `inset(0 ${100 - websrComparePosition}% 0 0)`;
  } else {
    canvas.style.clipPath = '';
    video.style.opacity = '0';
    video.style.clipPath = '';
  }
}, [websrCompareEnabled, websrComparePosition]);

// 鍔犺浇璇︽儏锛堣眴鐡ｆ垨bangumi锛?  useEffect(() => {
const loadMovieDetails = async () => {
  if (!videoDoubanId || videoDoubanId === 0 || detail?.source === 'shortdrama') {
    return;
  }

  // 妫€娴嬫槸鍚︿负bangumi ID
  if (isBangumiId(videoDoubanId)) {
    // 鍔犺浇bangumi璇︽儏
    if (loadingBangumiDetails || bangumiDetails) {
      return;
    }

    setLoadingBangumiDetails(true);
    try {
      const bangumiData = await fetchBangumiDetails(videoDoubanId);
      if (bangumiData) {
        setBangumiDetails(bangumiData);
      }
    } catch (error) {
      console.error('Failed to load bangumi details:', error);
    } finally {
      setLoadingBangumiDetails(false);
    }
  }
  // 馃殌 TanStack Query 浼氳嚜鍔ㄥ姞杞借眴鐡ｈ鎯呭拰璇勮锛屾棤闇€鎵嬪姩 useEffect
};

loadMovieDetails();
  }, [videoDoubanId, loadingBangumiDetails, bangumiDetails]);

// 馃殌 璞嗙摚璇勮鐢?useDoubanCommentsQuery 鑷姩鍔犺浇锛屾棤闇€鎵嬪姩 useEffect

// 鍔犺浇鐭墽璇︽儏锛堜粎鐢ㄤ簬鏄剧ず绠€浠嬬瓑淇℃伅锛屼笉褰卞搷婧愭悳绱級
useEffect(() => {
  const loadShortdramaDetails = async () => {
    if (!shortdramaId || loadingShortdramaDetails || shortdramaDetails) {
      return;
    }

    setLoadingShortdramaDetails(true);
    try {
      // 浼犻€?name 鍙傛暟浠ユ敮鎸佸鐢ˋPI fallback
      const dramaTitle = searchParams.get('title') || videoTitleRef.current || '';
      const titleParam = dramaTitle ? `&name=${encodeURIComponent(dramaTitle)}` : '';
      const response = await fetch(`/api/shortdrama/detail?id=${shortdramaId}&episode=1${titleParam}`);
      if (response.ok) {
        const data = await response.json();
        setShortdramaDetails(data);
      }
    } catch (error) {
      console.error('Failed to load shortdrama details:', error);
    } finally {
      setLoadingShortdramaDetails(false);
    }
  };

  loadShortdramaDetails();
}, [shortdramaId, loadingShortdramaDetails, shortdramaDetails]);

// 鑷姩缃戠洏鎼滅储锛氬綋鏈夎棰戞爣棰樻椂鍙互闅忔椂鎼滅储
useEffect(() => {
  // 绉婚櫎鑷姩鎼滅储锛屾敼涓虹敤鎴风偣鍑绘寜閽椂瑙﹀彂
  // 杩欐牱鍙互閬垮厤涓嶅繀瑕佺殑API璋冪敤
}, []);

// 瑙嗛鎾斁鍦板潃
const [videoUrl, setVideoUrl] = useState('');

// 鎬婚泦鏁?  const totalEpisodes = detail?.episodes?.length || 0;

// 鐢ㄤ簬璁板綍鏄惁闇€瑕佸湪鎾斁鍣?ready 鍚庤烦杞埌鎸囧畾杩涘害
const resumeTimeRef = useRef<number | null>(null);
// 涓婃浣跨敤鐨勯煶閲忥紝榛樿 0.7
const lastVolumeRef = useRef<number>(0.7);
// 涓婃浣跨敤鐨勬挱鏀鹃€熺巼锛岄粯璁?1.0
const lastPlaybackRateRef = useRef<number>(1.0);

const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
const [sourceSearchError, setSourceSearchError] = useState<string | null>(
  null
);
const [backgroundSourcesLoading, setBackgroundSourcesLoading] = useState(false);

// 浼橀€夊拰娴嬮€熷紑鍏?  const [optimizationEnabled] = useState<boolean>(() => {
if (typeof window !== 'undefined') {
  const saved = localStorage.getItem('enableOptimization');
  if (saved !== null) {
    try {
      return JSON.parse(saved);
    } catch {
      /* ignore */
    }
  }
}
return false;
  });

// 淇濆瓨浼橀€夋椂鐨勬祴閫熺粨鏋滐紝閬垮厤EpisodeSelector閲嶅娴嬮€?  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
Map < string, { quality: string; loadSpeed: string; pingTime: number } >
  > (new Map());

// 鎶樺彔鐘舵€侊紙浠呭湪 lg 鍙婁互涓婂睆骞曟湁鏁堬級
const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
  useState(false);

// 鎹㈡簮鍔犺浇鐘舵€?  const [isVideoLoading, setIsVideoLoading] = useState(true);
const [videoLoadingStage, setVideoLoadingStage] = useState<
  'initing' | 'sourceChanging'
>('initing');

// 鎾斁杩涘害淇濆瓨鐩稿叧
const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
const lastSaveTimeRef = useRef<number>(0);

// 馃殌 杩炵画鍒囨崲婧愰槻鎶栧拰璧勬簮绠＄悊
const episodeSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const isSourceChangingRef = useRef<boolean>(false); // 鏍囪鏄惁姝ｅ湪鎹㈡簮
const isEpisodeChangingRef = useRef<boolean>(false); // 鏍囪鏄惁姝ｅ湪鍒囨崲闆嗘暟
const isSkipControllerTriggeredRef = useRef<boolean>(false); // 鏍囪鏄惁閫氳繃 SkipController 瑙﹀彂浜嗕笅涓€闆?  const videoEndedHandledRef = useRef<boolean>(false); // 馃敟 鏍囪褰撳墠瑙嗛鐨?video:ended 浜嬩欢鏄惁宸茬粡琚鐞嗚繃锛堥槻姝㈠涓洃鍚櫒閲嶅瑙﹀彂锛?
// 馃殌 鏂板锛氳繛缁垏鎹㈡簮闃叉姈鍜岃祫婧愮鐞?  const sourceSwitchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const pendingSwitchRef = useRef<any>(null); // 淇濆瓨寰呭鐞嗙殑鍒囨崲璇锋眰
const switchPromiseRef = useRef<Promise<void> | null>(null); // 褰撳墠鍒囨崲鐨凱romise

// 鎾斁鍣ㄥ氨缁姸鎬?  const [playerReady, setPlayerReady] = useState(false);

// Wake Lock 鐩稿叧
const wakeLockRef = useRef<WakeLockSentinel | null>(null);

// 瑙傚奖瀹ゅ悓姝?  const {
isInRoom: isInWatchRoom,
  isOwner: isWatchRoomOwner,
    syncPaused,
    pauseSync,
    resumeSync,
    isSameVideoAsOwner,
    pendingOwnerChange,
    confirmFollowOwner,
    rejectFollowOwner,
    showSourceSwitchDialog,
    pendingOwnerState,
    handleConfirmSourceSwitch,
    handleCancelSourceSwitch,
  } = useWatchRoomSync({
      watchRoom,
      artPlayerRef,
      detail,
      episodeIndex: currentEpisodeIndex,
      playerReady,
      videoId: currentId,  // 浼犲叆URL鍙傛暟鐨刬d
      currentSource: currentSource,  // 浼犲叆褰撳墠鎾斁婧?    videoTitle: videoTitle,  // 浼犲叆瑙嗛鏍囬锛堟潵鑷?state锛屽垵濮嬪€兼潵鑷?URL锛?    videoYear: videoYear,  // 浼犲叆瑙嗛骞翠唤锛堟潵鑷?state锛屽垵濮嬪€兼潵鑷?URL锛?    videoDoubanId: videoDoubanId,  // 浼犲叆璞嗙摚ID
      searchTitle: searchTitle,  // 浼犲叆鎼滅储鏍囬
      setCurrentEpisodeIndex,  // 浼犲叆鍒囨崲闆嗘暟鐨勫嚱鏁?  });

      // 馃殌 鏁版嵁棰勫彇 - 涓嬩竴闆嗛鍙栵紙褰撴挱鏀捐繘搴﹁揪鍒?0%鏃讹級
      usePrefetchNextEpisode({
        detail,
        currentEpisodeIndex,
        currentTime: currentPlayTime,
        duration: videoDuration,
        source: currentSource,
        id: currentId,
      });

  // 馃殌 鏁版嵁棰勫彇 - 璞嗙摚鏁版嵁棰勫彇锛堝綋瑙嗛鍔犺浇鏃讹級
  usePrefetchDoubanData({
        videoDoubanId: videoDoubanId ? String(videoDoubanId) : null,
      enabled: !!videoDoubanId,
  });

// -----------------------------------------------------------------------------
// 宸ュ叿鍑芥暟锛圲tils锛?  // -----------------------------------------------------------------------------

// bangumi ID妫€娴嬶紙3-6浣嶆暟瀛楋級
const isBangumiId = (id: number): boolean => {
  const length = id.toString().length;
  return id > 0 && length >= 3 && length <= 6;
};

// bangumi缂撳瓨閰嶇疆
const BANGUMI_CACHE_EXPIRE = 4 * 60 * 60 * 1000; // 4灏忔椂锛屽拰douban璇︽儏涓€鑷?
// bangumi缂撳瓨宸ュ叿鍑芥暟锛堢粺涓€瀛樺偍锛?  const getBangumiCache = async (id: number) => {
try {
  const cacheKey = `bangumi-details-${id}`;
  // 浼樺厛浠庣粺涓€瀛樺偍鑾峰彇
  const cached = await ClientCache.get(cacheKey);
  if (cached) return cached;

  // 鍏滃簳锛氫粠localStorage鑾峰彇锛堝吋瀹规€э級
  if (typeof localStorage !== 'undefined') {
    const localCached = localStorage.getItem(cacheKey);
    if (localCached) {
      const { data, expire } = JSON.parse(localCached);
      if (Date.now() <= expire) {
        return data;
      }
      localStorage.removeItem(cacheKey);
    }
  }

  return null;
} catch (e) {
  console.warn('鑾峰彇Bangumi缂撳瓨澶辫触:', e);
  return null;
}
  };

const setBangumiCache = async (id: number, data: any) => {
  try {
    const cacheKey = `bangumi-details-${id}`;
    const expireSeconds = Math.floor(BANGUMI_CACHE_EXPIRE / 1000); // 杞崲涓虹

    // 涓昏瀛樺偍锛氱粺涓€瀛樺偍
    await ClientCache.set(cacheKey, data, expireSeconds);

    // 鍏滃簳瀛樺偍锛歭ocalStorage锛堝吋瀹规€э級
    if (typeof localStorage !== 'undefined') {
      try {
        const cacheData = {
          data,
          expire: Date.now() + BANGUMI_CACHE_EXPIRE,
          created: Date.now()
        };
        localStorage.setItem(cacheKey, JSON.stringify(cacheData));
      } catch (e) {
        // localStorage鍙兘婊′簡锛屽拷鐣ラ敊璇?        }
      }
    } catch (e) {
      console.warn('璁剧疆Bangumi缂撳瓨澶辫触:', e);
    }
  };

  // 鑾峰彇bangumi璇︽儏锛堝甫缂撳瓨锛?  const fetchBangumiDetails = async (bangumiId: number) => {
  // 妫€鏌ョ紦瀛?    const cached = await getBangumiCache(bangumiId);
  if (cached) {
    console.log(`Bangumi璇︽儏缂撳瓨鍛戒腑: ${bangumiId}`);
    return cached;
  }

  try {
    const response = await fetch(`/api/proxy/bangumi?path=v0/subjects/${bangumiId}`);
    if (response.ok) {
      const bangumiData = await response.json();

      // 淇濆瓨鍒扮紦瀛?        await setBangumiCache(bangumiId, bangumiData);
      console.log(`Bangumi璇︽儏宸茬紦瀛? ${bangumiId}`);

      return bangumiData;
    }
  } catch (error) {
    console.log('Failed to fetch bangumi details:', error);
  }
  return null;
};

/**
 * 鐢熸垚鎼滅储鏌ヨ鐨勫绉嶅彉浣擄紝鎻愰珮鎼滅储鍛戒腑鐜?   * @param originalQuery 鍘熷鏌ヨ
 * @returns 鎸変紭鍏堢骇鎺掑簭鐨勬悳绱㈠彉浣撴暟缁?   */
const generateSearchVariants = (originalQuery: string): string[] => {
  const variants: string[] = [];
  const trimmed = originalQuery.trim();

  // 1. 鍘熷鏌ヨ锛堟渶楂樹紭鍏堢骇锛?    variants.push(trimmed);

  // 2. 澶勭悊涓枃鏍囩偣绗﹀彿鍙樹綋
  const chinesePunctuationVariants = generateChinesePunctuationVariants(trimmed);
  chinesePunctuationVariants.forEach(variant => {
    if (!variants.includes(variant)) {
      variants.push(variant);
    }
  });

  // 3. 娣诲姞鏁板瓧鍙樹綋澶勭悊锛堝鐞?绗琗瀛? <-> "X" 鐨勮浆鎹級
  const numberVariants = generateNumberVariants(trimmed);
  numberVariants.forEach(variant => {
    if (!variants.includes(variant)) {
      variants.push(variant);
    }
  });

  // 濡傛灉鍖呭惈绌烘牸锛岀敓鎴愰澶栧彉浣?    if (trimmed.includes(' ')) {
  // 4. 鍘婚櫎鎵€鏈夌┖鏍?      const noSpaces = trimmed.replace(/\s+/g, '');
  if (noSpaces !== trimmed) {
    variants.push(noSpaces);
  }

  // 5. 鏍囧噯鍖栫┖鏍硷紙澶氫釜绌烘牸鍚堝苟涓轰竴涓級
  const normalizedSpaces = trimmed.replace(/\s+/g, ' ');
  if (normalizedSpaces !== trimmed && !variants.includes(normalizedSpaces)) {
    variants.push(normalizedSpaces);
  }

  // 6. 鎻愬彇鍏抽敭璇嶇粍鍚堬紙閽堝"涓鍘?绗節瀛?杩欑鎯呭喌锛?      const keywords = trimmed.split(/\s+/);
  if (keywords.length >= 2) {
    // 涓昏鍏抽敭璇?+ 瀛?闆嗙瓑鍚庣紑
    const mainKeyword = keywords[0];
    const lastKeyword = keywords[keywords.length - 1];

    // 濡傛灉鏈€鍚庝竴涓瘝鍖呭惈"绗?銆?瀛?銆?闆?绛夛紝灏濊瘯缁勫悎
    if (/绗瑋瀛闆唡閮▅绡噟绔?.test(lastKeyword)) {
      const combined = mainKeyword + lastKeyword;
      if (!variants.includes(combined)) {
        variants.push(combined);
      }
    }

    // 7. 绌烘牸鍙樺啋鍙风殑鍙樹綋锛堥噸瑕侊紒閽堝"姝荤鏉ヤ簡 琛€鑴夎瘏鍜? -> "姝荤鏉ヤ簡锛氳鑴夎瘏鍜?锛?        const withColon = trimmed.replace(/\s+/g, '锛?);
    if (!variants.includes(withColon)) {
      variants.push(withColon);
    }

    // 8. 绌烘牸鍙樿嫳鏂囧啋鍙风殑鍙樹綋
    const withEnglishColon = trimmed.replace(/\s+/g, ':');
    if (!variants.includes(withEnglishColon)) {
      variants.push(withEnglishColon);
    }

    // 浠呬娇鐢ㄤ富鍏抽敭璇嶆悳绱紙杩囨护鏃犳剰涔夌殑璇嶏級
    const meaninglessWords = ['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by'];
    if (!variants.includes(mainKeyword) &&
      !meaninglessWords.includes(mainKeyword.toLowerCase()) &&
      mainKeyword.length > 2) {
      variants.push(mainKeyword);
    }
  }
}

    // 鍘婚噸骞惰繑鍥?    return Array.from(new Set(variants));
  };

/**
 * 鐢熸垚鏁板瓧鍙樹綋鐨勬悳绱㈠彉浣擄紙澶勭悊"绗琗瀛? <-> "X"鐨勮浆鎹級
 * 浼樺寲锛氬彧鐢熸垚鏈€鏈夊彲鑳藉尮閰嶇殑鍓?-3涓彉浣?   * @param query 鍘熷鏌ヨ
 * @returns 鏁板瓧鍙樹綋鏁扮粍锛堟寜浼樺厛绾ф帓搴忥級
 */
const generateNumberVariants = (query: string): string[] => {
  const variants: string[] = [];

  // 涓枃鏁板瓧鍒伴樋鎷変集鏁板瓧鐨勬槧灏?    const chineseNumbers: { [key: string]: string } = {
  '涓€': '1', '浜?: '2', '涓 ?: '3', '鍥?: '4', '浜 ?: '5',
    '鍏?: '6', '涓 ?: '7', '鍏?: '8', '涔 ?: '9', '鍗?: '10',
};

// 1. 澶勭悊"绗琗瀛?閮?闆?鏍煎紡锛堟渶甯歌鐨勬儏鍐碉級
const seasonPattern = /绗?[涓€浜屼笁鍥涗簲鍏竷鍏節鍗乗d]+)(瀛閮▅闆唡鏈?/;
const match = seasonPattern.exec(query);

if (match) {
  const fullMatch = match[0];
  const number = match[1];
  const suffix = match[2];
  const arabicNumber = chineseNumbers[number] || number;
  const base = query.replace(fullMatch, '').trim();

  if (base) {
    // 鍙敓鎴愭渶甯歌鐨勬牸寮忥細鏃犵┖鏍硷紝濡?涓€鎷宠秴浜?"
    // 涓嶇敓鎴?涓€鎷宠秴浜?3"鍜?涓€鎷宠秴浜篠3"绛夊彉浣擄紝閬垮厤鍖归厤澶涓嶇浉鍏崇粨鏋?        variants.push(`${base}${arabicNumber}`);
  }
}

// 2. 澶勭悊鏈熬绾暟瀛楋紙濡?鐗х璁?"锛?    const endNumberMatch = query.match(/^(.+?)\s*(\d+)$/);
if (endNumberMatch) {
  const base = endNumberMatch[1].trim();
  const number = endNumberMatch[2];
  const chineseNum = ['', '涓€', '浜?, '涓 ?, '鍥?, '浜 ?, '鍏?, '涓 ?, '鍏?, '涔 ?, '鍗?][parseInt(number)];

      if (chineseNum && parseInt(number) <= 10) {
    // 鍙敓鎴愭棤绌烘牸甯?绗琗瀛?鐨勫彉浣擄紝濡?鐗х璁扮涓夊"
    variants.push(`${base}绗?{chineseNum}瀛);
      }
    }

    // 闄愬埗杩斿洖鍓?涓渶鏈夊彲鑳界殑鍙樹綋
    return variants.slice(0, 1);
  };

  // 绉婚櫎鏁板瓧鍙樹綋鐢熸垚鍑芥暟锛堜紭鍖栨€ц兘锛屼緷璧栫浉鍏虫€ц瘎鍒嗗鐞嗭級

  /**
   * 鐢熸垚涓枃鏍囩偣绗﹀彿鐨勬悳绱㈠彉浣?   * @param query 鍘熷鏌ヨ
   * @returns 鏍囩偣绗﹀彿鍙樹綋鏁扮粍
   */
  const generateChinesePunctuationVariants = (query: string): string[] => {
    const variants: string[] = [];

    // 妫€鏌ユ槸鍚﹀寘鍚腑鏂囨爣鐐圭鍙?    const chinesePunctuation = /[锛氾紱锛屻€傦紒锛熴€?"''锛堬級銆愩€戙€娿€媇/;
    if (!chinesePunctuation.test(query)) {
      return variants;
    }

    // 涓枃鍐掑彿鍙樹綋 (閽堝"姝荤鏉ヤ簡锛氳鑴夎瘏鍜?杩欑鎯呭喌)
    if (query.includes('锛?)) {
      // 浼樺厛绾?: 鏇挎崲涓虹┖鏍?(鏈€鍙兘鍖归厤锛屽"姝荤鏉ヤ簡 琛€鑴夎瘏鍜? 鑳藉尮閰嶅埌 "姝荤鏉ヤ簡6锛氳鑴夎瘏鍜?)
      const withSpace = query.replace(/锛?g, ' ');
      variants.push(withSpace);

      // 浼樺厛绾?: 瀹屽叏鍘婚櫎鍐掑彿
      const noColon = query.replace(/锛?g, '');
      variants.push(noColon);

      // 浼樺厛绾?: 鏇挎崲涓鸿嫳鏂囧啋鍙?      const englishColon = query.replace(/锛?g, ':');
      variants.push(englishColon);

      // 浼樺厛绾?: 鎻愬彇鍐掑彿鍓嶇殑涓绘爣棰?(闄嶄綆浼樺厛绾э紝閬垮厤鍖归厤鍒伴敊璇殑绯诲垪)
      const beforeColon = query.split('锛?)[0].trim();
      if (beforeColon && beforeColon !== query) {
        variants.push(beforeColon);
      }

      // 浼樺厛绾?: 鎻愬彇鍐掑彿鍚庣殑鍓爣棰?      const afterColon = query.split('锛?)[1]?.trim();
      if (afterColon) {
        variants.push(afterColon);
      }
    }

    // 鍏朵粬涓枃鏍囩偣绗﹀彿澶勭悊
    let cleanedQuery = query;

    // 鏇挎崲涓枃鏍囩偣涓哄搴旇嫳鏂囨爣鐐?    cleanedQuery = cleanedQuery.replace(/锛?g, ';');
    cleanedQuery = cleanedQuery.replace(/锛?g, ',');
    cleanedQuery = cleanedQuery.replace(/銆?g, '.');
    cleanedQuery = cleanedQuery.replace(/锛?g, '!');
    cleanedQuery = cleanedQuery.replace(/锛?g, '?');
    cleanedQuery = cleanedQuery.replace(/"/g, '"');
    cleanedQuery = cleanedQuery.replace(/"/g, '"');
    cleanedQuery = cleanedQuery.replace(/'/g, "'");
    cleanedQuery = cleanedQuery.replace(/'/g, "'");
    cleanedQuery = cleanedQuery.replace(/锛?g, '(');
    cleanedQuery = cleanedQuery.replace(/锛?g, ')');
    cleanedQuery = cleanedQuery.replace(/銆?g, '[');
    cleanedQuery = cleanedQuery.replace(/銆?g, ']');
    cleanedQuery = cleanedQuery.replace(/銆?g, '<');
    cleanedQuery = cleanedQuery.replace(/銆?g, '>');

    if (cleanedQuery !== query) {
      variants.push(cleanedQuery);
    }

    // 瀹屽叏鍘婚櫎鎵€鏈夋爣鐐圭鍙?    const noPunctuation = query.replace(/[锛氾紱锛屻€傦紒锛熴€?"''锛堬級銆愩€戙€娿€?;,.!?"'()[\]<>]/g, '');
    if (noPunctuation !== query && noPunctuation.trim()) {
      variants.push(noPunctuation);
    }

    return variants;
  };

  // 妫€鏌ユ槸鍚﹀寘鍚煡璇腑鐨勬墍鏈夊叧閿瘝锛堜笌downstream璇勫垎閫昏緫淇濇寔涓€鑷达級
  const checkAllKeywordsMatch = (queryTitle: string, resultTitle: string): boolean => {
    const queryWords = queryTitle.replace(/[^\w\s\u4e00-\u9fff]/g, '').split(/\s+/).filter(w => w.length > 0);

    // 妫€鏌ョ粨鏋滄爣棰樻槸鍚﹀寘鍚煡璇腑鐨勬墍鏈夊叧閿瘝
    return queryWords.every(word => resultTitle.includes(word));
  };

  // 缃戠洏鎼滅储鍑芥暟
  const handleNetDiskSearch = async (query: string) => {
    if (!query.trim()) return;

    setNetdiskLoading(true);
    setNetdiskError(null);
    setNetdiskResults(null);
    setNetdiskTotal(0);

    try {
      const response = await fetch(`/ api / netdisk / search ? q = ${ encodeURIComponent(query.trim())
  } `);
      const data = await response.json();

      if (data.success) {
        setNetdiskResults(data.data.merged_by_type || {});
        setNetdiskTotal(data.data.total || 0);
        console.log(`缃戠洏鎼滅储瀹屾垚: "${query}" - ${ data.data.total || 0 } 涓粨鏋渀);
} else {
  setNetdiskError(data.error || '缃戠洏鎼滅储澶辫触');
}
    } catch (error: any) {
  console.error('缃戠洏鎼滅储璇锋眰澶辫触:', error);
  setNetdiskError('缃戠洏鎼滅储璇锋眰澶辫触锛岃绋嶅悗閲嶈瘯');
} finally {
  setNetdiskLoading(false);
}
  };

// 澶勭悊婕斿憳鐐瑰嚮浜嬩欢
const handleCelebrityClick = async (celebrityName: string) => {
  // 濡傛灉鐐瑰嚮鐨勬槸宸查€変腑鐨勬紨鍛橈紝鍒欐敹璧?    if (selectedCelebrityName === celebrityName) {
  setSelectedCelebrityName(null);
  setCelebrityWorks([]);
  return;
}

setSelectedCelebrityName(celebrityName);
setLoadingCelebrityWorks(true);
setCelebrityWorks([]);

try {
  // 妫€鏌ョ紦瀛?      const cacheKey = `douban-celebrity-${celebrityName}`;
  const cached = await ClientCache.get(cacheKey);

  if (cached) {
    console.log(`婕斿憳浣滃搧缂撳瓨鍛戒腑: ${celebrityName}`);
    setCelebrityWorks(cached);
    setLoadingCelebrityWorks(false);
    return;
  }

  console.log('鎼滅储婕斿憳浣滃搧:', celebrityName);

  // 涓夌骇 fallback锛氳眴鐡ｉ€氱敤鎼滅储 -> 璞嗙摚API -> TMDB
  let works: any[] = [];
  let source = '';

  // 1. 璞嗙摚閫氱敤鎼滅储锛堜富鐢紝鏁版嵁鏈€鍏級
  try {
    const response = await fetch(`/api/douban/celebrity-works?name=${encodeURIComponent(celebrityName)}&limit=20`);
    const data = await response.json();
    if (data.success && data.works && data.works.length > 0) {
      works = data.works;
      source = 'douban-search';
      console.log(`鎵惧埌 ${works.length} 閮?${celebrityName} 鐨勪綔鍝侊紙璞嗙摚閫氱敤鎼滅储锛塦);
        }
      } catch (e) {
        console.warn('璞嗙摚閫氱敤鎼滅储澶辫触:', e);
      }

      // 2. 璞嗙摚 API锛堝鐢級
      if (works.length === 0) {
        console.log('璞嗙摚閫氱敤鎼滅储鏃犵粨鏋滐紝灏濊瘯璞嗙摚API...');
        try {
          const apiResponse = await fetch(`/ api / douban / celebrity - works ? name = ${ encodeURIComponent(celebrityName) } & limit=20 & mode=api`);
          const apiData = await apiResponse.json();
          if (apiData.success && apiData.works && apiData.works.length > 0) {
            works = apiData.works;
            source = 'douban-api';
            console.log(`鎵惧埌 ${ works.length } 閮 ? ${ celebrityName } 鐨勪綔鍝侊紙璞嗙摚API锛塦);
    }
  } catch (e) {
    console.warn('璞嗙摚API鎼滅储澶辫触:', e);
  }
}

      // 3. TMDB锛堟渶鍚?fallback锛?      if (works.length === 0) {
        console.log('璞嗙摚鏃犵粨鏋滐紝灏濊瘯TMDB...');
try {
  const tmdbResponse = await fetch(`/api/tmdb/actor?actor=${encodeURIComponent(celebrityName)}&type=movie&limit=20`);
  const tmdbResult = await tmdbResponse.json();
  if (tmdbResult.code === 200 && tmdbResult.list && tmdbResult.list.length > 0) {
    works = tmdbResult.list.map((work: any) => ({
      ...work,
      source: 'tmdb'
    }));
    source = 'tmdb';
    console.log(`鎵惧埌 ${works.length} 閮?${celebrityName} 鐨勪綔鍝侊紙TMDB锛塦);
          }
        } catch (e) {
          console.warn('TMDB鎼滅储澶辫触:', e);
        }
      }

      if (works.length > 0) {
        await ClientCache.set(cacheKey, works, 2 * 60 * 60);
        setCelebrityWorks(works);
        console.log(`婕斿憳浣滃搧宸茬紦瀛 ? ${ celebrityName }(${ source })`);
      } else {
        console.log('鎵€鏈夋簮鍧囨湭鎵惧埌鐩稿叧浣滃搧');
        setCelebrityWorks([]);
      }
    } catch (error) {
      console.error('鑾峰彇婕斿憳浣滃搧鍑洪敊:', error);
      setCelebrityWorks([]);
    } finally {
      setLoadingCelebrityWorks(false);
    }
  };

  // 鑾峰彇婧愭潈閲嶆槧灏?  const fetchSourceWeights = async (): Promise<Record<string, number>> => {
    try {
      const response = await fetch('/api/source-weights');
      if (!response.ok) {
        console.warn('鑾峰彇婧愭潈閲嶅け璐ワ紝浣跨敤榛樿鏉冮噸');
        return {};
      }
      const data = await response.json();
      return data.weights || {};
    } catch (error) {
      console.warn('鑾峰彇婧愭潈閲嶅け璐?', error);
      return {};
    }
  };

  // 鎸夋潈閲嶆帓搴忔簮锛堟潈閲嶉珮鐨勫湪鍓嶏級
  const sortSourcesByWeight = (sources: SearchResult[], weights: Record<string, number>): SearchResult[] => {
    return [...sources].sort((a, b) => {
      const weightA = weights[a.source] ?? 50;
      const weightB = weights[b.source] ?? 50;
      return weightB - weightA; // 闄嶅簭鎺掑垪锛屾潈閲嶉珮鐨勫湪鍓?    });
  };

  // 璁剧疆鍙敤婧愬垪琛紙鍏堟寜鏉冮噸鎺掑簭锛?  const setAvailableSourcesWithWeight = async (sources: SearchResult[]): Promise<SearchResult[]> => {
    if (sources.length <= 1) {
      setAvailableSources(sources);
      return sources;
    }
    const weights = await fetchSourceWeights();
    const sortedSources = sortSourcesByWeight(sources, weights);
    console.log('鎸夋潈閲嶆帓搴忓彲鐢ㄦ簮:', sortedSources.map(s => `${ s.source_name }(${ weights[s.source] ?? 50 })`).slice(0, 5), '...');
    setAvailableSources(sortedSources);
    return sortedSources;
  };

  // 鎾斁婧愪紭閫夊嚱鏁帮紙閽堝鏃Pad鍋氭瀬绔繚瀹堜紭鍖栵級
  const preferBestSource = async (
    sources: SearchResult[]
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 馃幆 鑾峰彇婧愭潈閲嶅苟鎸夋潈閲嶆帓搴?    const weights = await fetchSourceWeights();
    const weightedSources = sortSourcesByWeight(sources, weights);
    console.log('鎸夋潈閲嶆帓搴忓悗鐨勬簮:', weightedSources.map(s => `${ s.source_name }(${ weights[s.source] ?? 50 })`));

    // 浣跨敤鍏ㄥ眬缁熶竴鐨勮澶囨娴嬬粨鏋?    const _isIPad = /iPad/i.test(userAgent) || (userAgent.includes('Macintosh') && navigator.maxTouchPoints >= 1);
    const _isIOS = isIOSGlobal;
    const isIOS13 = isIOS13Global;
    const isMobile = isMobileGlobal;

    // 濡傛灉鏄痠Pad鎴杋OS13+锛堝寘鎷柊iPad鍦ㄦ闈㈡ā寮忎笅锛夛紝浣跨敤鏋佺畝绛栫暐閬垮厤宕╂簝
    if (isIOS13) {
      console.log('妫€娴嬪埌iPad/iOS13+璁惧锛屼娇鐢ㄦ棤娴嬮€熶紭閫夌瓥鐣ラ伩鍏嶅穿婧?);

      // 鐩存帴杩斿洖鏉冮噸鏈€楂樼殑婧愶紙宸叉寜鏉冮噸鎺掑簭锛?      // 鍚屾椂淇濈暀鍘熸潵鐨勬簮鍚嶇О浼樺厛绾т綔涓哄鐢ㄦ帓搴?      const sourcePreference = [
        'ok', 'niuhu', 'ying', 'wasu', 'mgtv', 'iqiyi', 'youku', 'qq'
      ];

      const sortedSources = weightedSources.sort((a, b) => {
        // 棣栧厛鎸夋潈閲嶆帓搴忥紙宸茬粡鎺掑ソ浜嗭級
        const weightA = weights[a.source] ?? 50;
        const weightB = weights[b.source] ?? 50;
        if (weightA !== weightB) {
          return weightB - weightA;
        }

        // 鏉冮噸鐩稿悓鏃讹紝鎸夋簮鍚嶇О浼樺厛绾ф帓搴?        const aIndex = sourcePreference.findIndex(name =>
          a.source_name?.toLowerCase().includes(name)
        );
        const bIndex = sourcePreference.findIndex(name =>
          b.source_name?.toLowerCase().includes(name)
        );

        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex;
        }
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;

        return 0;
      });

      console.log('iPad/iOS13+浼橀€夌粨鏋?', sortedSources.map(s => s.source_name));
      return sortedSources[0];
    }

    // 绉诲姩璁惧浣跨敤杞婚噺绾ф祴閫燂紙浠卲ing锛屼笉鍒涘缓HLS锛?    if (isMobile) {
      console.log('绉诲姩璁惧浣跨敤杞婚噺绾т紭閫?);
      return await lightweightPreference(weightedSources, weights);
    }

    // 妗岄潰璁惧浣跨敤鍘熸潵鐨勬祴閫熸柟娉曪紙鎺у埗骞跺彂锛?    return await fullSpeedTest(weightedSources, weights);
  };

  // 杞婚噺绾т紭閫夛細浠呮祴璇曡繛閫氭€э紝涓嶅垱寤簐ideo鍜孒LS
  const lightweightPreference = async (sources: SearchResult[], weights: Record<string, number> = {}): Promise<SearchResult> => {
    console.log('寮€濮嬭交閲忕骇娴嬮€燂紝浠呮祴璇曡繛閫氭€?);

    const results = await Promise.all(
      sources.map(async (source) => {
        try {
          if (!source.episodes || source.episodes.length === 0) {
            return { source, pingTime: 9999, available: false, weight: weights[source.source] ?? 50 };
          }

          const episodeUrl = source.episodes.length > 1
            ? source.episodes[1]
            : source.episodes[0];

          // 浠呮祴璇曡繛閫氭€у拰鍝嶅簲鏃堕棿
          const startTime = performance.now();
          await fetch(episodeUrl, {
            method: 'HEAD',
            mode: 'no-cors',
            signal: AbortSignal.timeout(3000) // 3绉掕秴鏃?          });
          const pingTime = performance.now() - startTime;

          return {
            source,
            pingTime: Math.round(pingTime),
            available: true,
            weight: weights[source.source] ?? 50
          };
        } catch (error) {
          console.warn(`杞婚噺绾ф祴閫熷け璐 ? ${ source.source_name }`, error);
          return { source, pingTime: 9999, available: false, weight: weights[source.source] ?? 50 };
        }
      })
    );

    // 鎸夋潈閲嶅垎缁勶紝鍦ㄥ悓鏉冮噸缁勫唴鎸塸ing鏃堕棿鎺掑簭
    const sortedResults = results
      .filter(r => r.available)
      .sort((a, b) => {
        // 棣栧厛鎸夋潈閲嶉檷搴?        if (a.weight !== b.weight) {
          return b.weight - a.weight;
        }
        // 鍚屾潈閲嶆寜ping鏃堕棿鍗囧簭
        return a.pingTime - b.pingTime;
      });

    if (sortedResults.length === 0) {
      console.warn('鎵€鏈夋簮閮戒笉鍙敤锛岃繑鍥炵涓€涓?);
      return sources[0];
    }

    console.log('杞婚噺绾т紭閫夌粨鏋?', sortedResults.map(r => 
      `${ r.source.source_name }: ${ r.pingTime }ms`
    ));
    
    return sortedResults[0].source;
  };

  // 瀹屾暣娴嬮€燂紙妗岄潰璁惧锛?  const fullSpeedTest = async (sources: SearchResult[], weights: Record<string, number> = {}): Promise<SearchResult> => {
    // 妗岄潰璁惧浣跨敤灏忔壒閲忓苟鍙戯紝閬垮厤鍒涘缓杩囧瀹炰緥
    const concurrency = 3;
    // 闄愬埗鏈€澶ф祴璇曟暟閲忎负20涓簮锛堝钩琛￠€熷害鍜岃鐩栫巼锛?    const maxTestCount = 20;
    const topPriorityCount = 5; // 鍓?涓紭鍏堢骇鏈€楂樼殑婧愶紙宸叉寜鏉冮噸鎺掑簭锛?
    // 馃幆 娣峰悎绛栫暐锛氬墠5涓紙楂樻潈閲嶏級+ 闅忔満15涓?    let sourcesToTest: SearchResult[];
    if (sources.length <= maxTestCount) {
      // 濡傛灉婧愭€绘暟涓嶈秴杩?0涓紝鍏ㄩ儴娴嬭瘯
      sourcesToTest = sources;
    } else {
      // 淇濈暀鍓?涓紙宸叉寜鏉冮噸鎺掑簭锛屾潈閲嶆渶楂樼殑鍦ㄥ墠锛?      const prioritySources = sources.slice(0, topPriorityCount);

      // 浠庡墿浣欐簮涓殢鏈洪€夋嫨15涓?      const remainingSources = sources.slice(topPriorityCount);
      const shuffled = remainingSources.sort(() => 0.5 - Math.random());
      const randomSources = shuffled.slice(0, maxTestCount - topPriorityCount);

      sourcesToTest = [...prioritySources, ...randomSources];
    }

    console.log(`寮€濮嬫祴閫 ? 鍏 ? { sources.length }涓簮锛屽皢娴嬭瘯鍓 ? { topPriorityCount }涓珮鏉冮噸婧 ? + 闅忔満${ sourcesToTest.length - Math.min(topPriorityCount, sources.length) }涓 ?= ${ sourcesToTest.length }涓猔);

    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    let shouldStop = false; // 鏃╁仠鏍囧織
    let testedCount = 0; // 宸叉祴璇曟暟閲?
    for (let i = 0; i < sourcesToTest.length && !shouldStop; i += concurrency) {
      const batch = sourcesToTest.slice(i, i + concurrency);
      console.log(`娴嬮€熸壒娆?${Math.floor(i / concurrency) + 1}/${Math.ceil(sourcesToTest.length / concurrency)}: ${batch.length} 涓簮`);

      const batchResults = await Promise.all(
        batch.map(async (source, batchIndex) => {
          try {
            // 鏇存柊杩涘害锛氭樉绀哄綋鍓嶆鍦ㄦ祴璇曠殑婧?            const currentIndex = i + batchIndex + 1;
            setSpeedTestProgress({
              current: currentIndex,
              total: sourcesToTest.length,
              currentSource: source.source_name,
            });

            if (!source.episodes || source.episodes.length === 0) {
              return null;
            }

            const episodeUrl = source.episodes.length > 1
              ? source.episodes[1]
              : source.episodes[0];

            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            // 鏇存柊杩涘害锛氭樉绀烘祴璇曠粨鏋?            setSpeedTestProgress({
            current: currentIndex,
              total: sourcesToTest.length,
                currentSource: source.source_name,
                  result: `${testResult.quality} | ${testResult.loadSpeed} | ${testResult.pingTime}ms`,
            });

      return { source, testResult };
    } catch (error) {
      console.warn(`娴嬮€熷け璐? ${source.source_name}`, error);

      // 鏇存柊杩涘害锛氭樉绀哄け璐?            const currentIndex = i + batchIndex + 1;
      setSpeedTestProgress({
        current: currentIndex,
        total: sourcesToTest.length,
        currentSource: source.source_name,
        result: '娴嬮€熷け璐?,
      });

      return null;
    }
  })
      );

  allResults.push(...batchResults);
  testedCount += batch.length;

  // 馃幆 淇濆畧绛栫暐鏃╁仠鍒ゆ柇锛氭壘鍒伴珮璐ㄩ噺婧?      const successfulInBatch = batchResults.filter(Boolean) as Array<{
  source: SearchResult;
  testResult: { quality: string; loadSpeed: string; pingTime: number };
}>;

for (const result of successfulInBatch) {
  const { quality, loadSpeed } = result.testResult;
  const speedMatch = loadSpeed.match(/^([\d.]+)\s*MB\/s$/);
  const speedMBps = speedMatch ? parseFloat(speedMatch[1]) : 0;

  // 馃洃 淇濆畧绛栫暐锛氬彧鏈夐潪甯镐紭璐ㄧ殑婧愭墠鏃╁仠
  const is4KHighSpeed = quality === '4K' && speedMBps >= 8;
  const is2KHighSpeed = quality === '2K' && speedMBps >= 6;

  if (is4KHighSpeed || is2KHighSpeed) {
    console.log(`鉁?鎵惧埌椤剁骇浼樿川婧? ${result.source.source_name} (${quality}, ${loadSpeed})锛屽仠姝㈡祴閫焋);
          shouldStop = true;
          break;
        }
      }

      // 鎵规闂村欢杩燂紝璁╄祫婧愭湁鏃堕棿娓呯悊锛堝噺灏戝欢杩熸椂闂达級
      if (i + concurrency < sourcesToTest.length && !shouldStop) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // 绛夊緟鎵€鏈夋祴閫熷畬鎴愶紝鍖呭惈鎴愬姛鍜屽け璐ョ殑缁撴灉
    // 淇濆瓨鎵€鏈夋祴閫熺粨鏋滃埌 precomputedVideoInfo锛屼緵 EpisodeSelector 浣跨敤锛堝寘鍚敊璇粨鏋滐級
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${ source.source } - ${ source.id }`;

      if (result) {
        // 鎴愬姛鐨勭粨鏋?        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 杩囨护鍑烘垚鍔熺殑缁撴灉鐢ㄤ簬浼橀€夎绠?    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('鎵€鏈夋挱鏀炬簮娴嬮€熼兘澶辫触锛屼娇鐢ㄧ涓€涓挱鏀炬簮');
      return sources[0];
    }

    // 鎵惧嚭鎵€鏈夋湁鏁堥€熷害鐨勬渶澶у€硷紝鐢ㄤ簬绾挎€ф槧灏?    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '鏈煡' || speedStr === '娴嬮噺涓?..') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 缁熶竴杞崲涓?KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 榛樿1MB/s浣滀负鍩哄噯

    // 鎵惧嚭鎵€鏈夋湁鏁堝欢杩熺殑鏈€灏忓€煎拰鏈€澶у€硷紝鐢ㄤ簬绾挎€ф槧灏?    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 璁＄畻姣忎釜缁撴灉鐨勮瘎鍒嗭紙缁撳悎娴嬮€熺粨鏋滃拰鏉冮噸锛?    const resultsWithScore = successfulResults.map((result) => {
      const testScore = calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing
      );
      const weight = weights[result.source.source] ?? 50;
      // 鏉冮噸鍔犳垚锛氭潈閲嶆瘡澧炲姞10鍒嗭紝鎬诲垎澧炲姞5%
      // 渚嬪锛氭潈閲?00鐨勬簮姣旀潈閲?0鐨勬簮锛屾€诲垎楂樺嚭25%
      const weightBonus = 1 + (weight - 50) * 0.005;
      const finalScore = testScore * weightBonus;
      return {
        ...result,
        score: finalScore,
        testScore,
        weight,
      };
    });

    // 鎸夌患鍚堣瘎鍒嗘帓搴忥紝閫夋嫨鏈€浣虫挱鏀炬簮
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('鎾斁婧愯瘎鍒嗘帓搴忕粨鏋滐紙鍚潈閲嶅姞鎴愶級:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${ index + 1}. ${
    result.source.source_name
  } - 鎬诲垎: ${ result.score.toFixed(2) } (娴嬮€熷垎: ${ result.testScore.toFixed(2) }, 鏉冮噸: ${ result.weight })[${ result.testResult.quality }, ${
    result.testResult.loadSpeed
  }, ${ result.testResult.pingTime }ms]`
      );
    });

    // 娓呴櫎娴嬮€熻繘搴︾姸鎬?    setSpeedTestProgress(null);

    return resultsWithScore[0].source;
  };

  // 璁＄畻鎾斁婧愮患鍚堣瘎鍒?  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number
  ): number => {
    let score = 0;

    // 鍒嗚鲸鐜囪瘎鍒?(40% 鏉冮噸)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 涓嬭浇閫熷害璇勫垎 (40% 鏉冮噸) - 鍩轰簬鏈€澶ч€熷害绾挎€ф槧灏?    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '鏈煡' || speedStr === '娴嬮噺涓?..') return 30;

      // 瑙ｆ瀽閫熷害鍊?      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 鍩轰簬鏈€澶ч€熷害绾挎€ф槧灏勶紝鏈€楂?00鍒?      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 缃戠粶寤惰繜璇勫垎 (20% 鏉冮噸) - 鍩轰簬寤惰繜鑼冨洿绾挎€ф槧灏?    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 鏃犳晥寤惰繜缁欓粯璁ゅ垎

      // 濡傛灉鎵€鏈夊欢杩熼兘鐩稿悓锛岀粰婊″垎
      if (maxPing === minPing) return 100;

      // 绾挎€ф槧灏勶細鏈€浣庡欢杩?100鍒嗭紝鏈€楂樺欢杩?0鍒?      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 淇濈暀涓や綅灏忔暟
  };

  // 鏇存柊瑙嗛鍦板潃
  const updateVideoUrl = async (
    detailData: SearchResult | null,
    episodeIndex: number
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }

    const episodeData = detailData.episodes[episodeIndex];

    // 妫€鏌ユ槸鍚︿负鐭墽鏍煎紡
    if (episodeData && episodeData.startsWith('shortdrama:')) {
      try {
        const [, videoId, episode] = episodeData.split(':');
        // 娣诲姞鍓у悕鍙傛暟浠ユ敮鎸佸鐢ˋPI fallback
        const nameParam = detailData.drama_name ? `& name=${ encodeURIComponent(detailData.drama_name) } ` : '';
        const response = await fetch(
          `/ api / shortdrama / parse ? id = ${ videoId }& episode=${ episode }${ nameParam } `
        );

        if (response.ok) {
          const result = await response.json();
          const newUrl = result.url || '';
          if (newUrl !== videoUrl) {
            setVideoUrl(newUrl);
          }
        } else {
          // 璇诲彇API杩斿洖鐨勯敊璇俊鎭?          try {
            const errorData = await response.json();
            setError(errorData.error || '鐭墽瑙ｆ瀽澶辫触');
          } catch {
            setError('鐭墽瑙ｆ瀽澶辫触');
          }
          setVideoUrl('');
        }
      } catch (err) {
        console.error('鐭墽URL瑙ｆ瀽澶辫触:', err);
        setError('鎾斁澶辫触锛岃绋嶅悗鍐嶈瘯');
        setVideoUrl('');
      }
    } else {
      // 鏅€氳棰戞牸寮?      const newUrl = episodeData || '';
      if (newUrl !== videoUrl) {
        setVideoUrl(newUrl);
      }
    }
  };

  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 绉婚櫎鏃х殑 source锛屼繚鎸佸敮涓€
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 濮嬬粓鍏佽杩滅▼鎾斁锛圓irPlay / Cast锛?    video.disableRemotePlayback = false;
    // 濡傛灉鏇剧粡鏈夌鐢ㄥ睘鎬э紝绉婚櫎涔?    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  // 妫€娴嬬Щ鍔ㄨ澶囷紙鍦ㄧ粍浠跺眰绾у畾涔夛級- 鍙傝€傾rtPlayer compatibility.js
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOSGlobal = /iPad|iPhone|iPod/i.test(userAgent) && !(window as any).MSStream;
  const isIOS13Global = isIOSGlobal || (userAgent.includes('Macintosh') && navigator.maxTouchPoints >= 1);
  const isMobileGlobal = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent) || isIOS13Global;

  // 鍐呭瓨鍘嬪姏妫€娴嬪拰娓呯悊锛堥拡瀵圭Щ鍔ㄨ澶囷級
  const checkMemoryPressure = async () => {
    // 浠呭湪鏀寔performance.memory鐨勬祻瑙堝櫒涓墽琛?    if (typeof performance !== 'undefined' && 'memory' in performance) {
      try {
        const memInfo = (performance as any).memory;
        const usedJSHeapSize = memInfo.usedJSHeapSize;
        const heapLimit = memInfo.jsHeapSizeLimit;
        
        // 璁＄畻鍐呭瓨浣跨敤鐜?        const memoryUsageRatio = usedJSHeapSize / heapLimit;
        
        console.log(`鍐呭瓨浣跨敤鎯呭喌: ${ (memoryUsageRatio * 100).toFixed(2) }% (${ (usedJSHeapSize / 1024 / 1024).toFixed(2) } MB / ${ (heapLimit / 1024 / 1024).toFixed(2) }MB)`);
        
        // 濡傛灉鍐呭瓨浣跨敤瓒呰繃75%锛岃Е鍙戞竻鐞?        if (memoryUsageRatio > 0.75) {
          console.warn('鍐呭瓨浣跨敤杩囬珮锛屾竻鐞嗙紦瀛?..');
          
          // 娓呯悊寮瑰箷缂撳瓨
          try {
            // 娓呯悊缁熶竴瀛樺偍涓殑寮瑰箷缂撳瓨
            await ClientCache.clearExpired('danmu-cache');
            
            // 鍏滃簳娓呯悊localStorage涓殑寮瑰箷缂撳瓨锛堝吋瀹规€э級
            const oldCacheKey = 'lunatv_danmu_cache';
            localStorage.removeItem(oldCacheKey);
            console.log('寮瑰箷缂撳瓨宸叉竻鐞?);
          } catch (e) {
            console.warn('娓呯悊寮瑰箷缂撳瓨澶辫触:', e);
          }
          
          // 灏濊瘯寮哄埗鍨冨溇鍥炴敹锛堝鏋滃彲鐢級
          if (typeof (window as any).gc === 'function') {
            (window as any).gc();
            console.log('宸茶Е鍙戝瀮鍦惧洖鏀?);
          }
          
          return true; // 杩斿洖鐪熻〃绀洪珮鍐呭瓨鍘嬪姏
        }
      } catch (error) {
        console.warn('鍐呭瓨妫€娴嬪け璐?', error);
      }
    }
    return false;
  };

  // 瀹氭湡鍐呭瓨妫€鏌ワ紙浠呭湪绉诲姩璁惧涓婏級
  useEffect(() => {
    if (!isMobileGlobal) return;
    
    const memoryCheckInterval = setInterval(() => {
      // 寮傛璋冪敤鍐呭瓨妫€鏌ワ紝涓嶉樆濉炲畾鏃跺櫒
      checkMemoryPressure().catch(console.error);
    }, 30000); // 姣?0绉掓鏌ヤ竴娆?    
    return () => {
      clearInterval(memoryCheckInterval);
    };
  }, [isMobileGlobal]);
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen'
        );
        console.log('Wake Lock 宸插惎鐢?);
      }
    } catch (err) {
      console.warn('Wake Lock 璇锋眰澶辫触:', err);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 宸查噴鏀?);
      }
    } catch (err) {
      console.warn('Wake Lock 閲婃斁澶辫触:', err);
    }
  };

  // 娓呯悊鎾斁鍣ㄨ祫婧愮殑缁熶竴鍑芥暟
  const cleanupPlayer = async () => {
    // dismantle any active WebSR processes
    await destroyWebSR();

    // clear pending episode switch timers
    if (episodeSwitchTimeoutRef.current) {
      clearTimeout(episodeSwitchTimeoutRef.current);
      episodeSwitchTimeoutRef.current = null;
    }

    // reset danmuku plugin state placeholder

    if (artPlayerRef.current) {
      try {
        // terminate danmuku worker if present

          if (danmukuPlugin.worker && typeof danmukuPlugin.worker.terminate === 'function') {
            danmukuPlugin.worker.terminate();
            console.log('danmuku WebWorker terminated');
          }

          if (typeof danmukuPlugin.reset === 'function') {
            danmukuPlugin.reset();
          }
        }

        // destroy Shaka player instance if exists
        if (shakaPlayerRef.current) {
          try {
            shakaPlayerRef.current.destroy();
          } catch {}
          shakaPlayerRef.current = null;
        }

        // clear adapter reference and update state
        artPlayerRef.current = null;
        setPlayerReady(false);
        console.log('player cleaned up');
      } catch (err) {
        console.warn('error during player cleanup:', err);
        artPlayerRef.current = null;
        setPlayerReady(false);
      }
    }
  };

  // WebSR 杈呭姪鍑芥暟锛氳幏鍙栫綉缁滃悕绉?  const getWebsrNetworkName = (mode: 'upscale' | 'restore', size: 's' | 'm' | 'l'): any => {
    if (mode === 'restore') {
      return `anime4k / cnn - restore - ${ size } `;
    }
    return `anime4k / cnn - 2x - ${ size } `;
  };

  // WebSR 杈呭姪鍑芥暟锛氳幏鍙栨潈閲嶆枃浠跺悕
  const getWebsrWeightFilename = (
    mode: 'upscale' | 'restore',
    size: 's' | 'm' | 'l',
    contentType: 'an' | 'rl' | '3d'
  ): string => {
    if (mode === 'restore') {
      return `cnn - restore - ${ size } -an.json`;
    }
    return `cnn - 2x - ${ size } -${ contentType }.json`;
  };

  // 鍒濆鍖朅nime4K瓒呭垎
  const initWebSR = async () => {
    if (!artPlayerRef.current?.video) return;

    try {
      const video = artPlayerRef.current.video as HTMLVideoElement;

      // 绛夊緟瑙嗛灏哄灏辩华
      if (!video.videoWidth || !video.videoHeight) {
        await new Promise<void>((resolve) => {
          const handler = () => {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          };
          video.addEventListener('loadedmetadata', handler);
          if (video.videoWidth && video.videoHeight) {
            video.removeEventListener('loadedmetadata', handler);
            resolve();
          }
        });
      }

      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('鏃犳硶鑾峰彇瑙嗛灏哄');
      }

      // 鍒濆鍖?GPU锛堝鐢ㄥ凡鏈夌殑鎴栧垱寤烘柊鐨勶級
      if (!websrRef.current.gpu) {
        const { default: WebSR } = await import('@websr/websr');
        const gpu = await WebSR.initWebGPU();
        if (!gpu) {
          throw new Error('WebGPU 鍒濆鍖栧け璐?);
        }
        websrRef.current.gpu = gpu;
      }

      // 鍒涘缓 canvas
      const canvas = document.createElement('canvas');
      const scale = websrModeRef.current === 'upscale' ? 2 : 1;
      canvas.width = Math.floor(video.videoWidth * scale);
      canvas.height = Math.floor(video.videoHeight * scale);

      // Canvas 鏍峰紡
      canvas.style.position = 'absolute';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.objectFit = 'contain';
      canvas.style.pointerEvents = 'none'; // 璁╃偣鍑荤┛閫忓埌 ArtPlayer
      canvas.style.zIndex = '1';

      // insert canvas overlay next to video element
      const container = video.parentElement;
      if (container) {
        container.insertBefore(canvas, video);
      }
      // 鑾峰彇鏉冮噸鏂囦欢
      const weightFile = getWebsrWeightFilename(
        websrModeRef.current,
        websrNetworkSizeRef.current,
        websrContentTypeRef.current
      );

      let weights = websrRef.current.weightsCache.get(weightFile);
      if (!weights) {
        const response = await fetch(`/ weights / anime4k / ${ weightFile } `);
        if (!response.ok) {
          throw new Error(`鏉冮噸鏂囦欢鍔犺浇澶辫触: ${ weightFile } `);
        }
        weights = await response.json();
        websrRef.current.weightsCache.set(weightFile, weights);
      }

      // 鍒涘缓 WebSR 瀹炰緥
      const { default: WebSR } = await import('@websr/websr');
      const networkName = getWebsrNetworkName(websrModeRef.current, websrNetworkSizeRef.current);

      const websr = new WebSR({
        canvas: canvas,
        weights: weights,
        network_name: networkName,
        gpu: websrRef.current.gpu,
      });

      websrRef.current.instance = websr;
      websrRef.current.canvas = canvas;
      websrRef.current.isActive = true;
      websrRef.current.renderLoopActive = true;

      // 浣跨敤 requestVideoFrameCallback 鎵嬪姩娓叉煋寰幆
      const renderFrame = () => {
        if (!websrRef.current.renderLoopActive || !websrRef.current.instance) return;
        websrRef.current.instance.render(video).then(() => {
          if (websrRef.current.renderLoopActive) {
            video.requestVideoFrameCallback(renderFrame);
          }
        }).catch((err: any) => {
          console.warn('WebSR render error:', err);
          if (websrRef.current.renderLoopActive) {
            video.requestVideoFrameCallback(renderFrame);
          }
        });
      };
      video.requestVideoFrameCallback(renderFrame);

      // 闅愯棌鍘熷瑙嗛
      video.style.opacity = '0';
      video.style.position = 'absolute';

      const modeText = websrModeRef.current === 'upscale' ? '2x瓒呭垎' : '闄嶅櫔';
      const sizeText = { s: '蹇€?, m: '鏍囧噯', l: '楂樿川' }[websrNetworkSizeRef.current];
      const typeText = { an: '鍔ㄦ极', rl: '鐪熶汉', '3d': '3D' }[websrContentTypeRef.current];

      console.log(`WebSR宸插惎鐢 ? ${ modeText } | ${ sizeText } | ${ typeText } `);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = `瓒呭垎宸插惎鐢 ? (${ modeText }, ${ sizeText }, ${ typeText })`;
      }
    } catch (err) {
      console.error('鍒濆鍖朩ebSR澶辫触:', err);
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '瓒呭垎鍚敤澶辫触锛? + (err instanceof Error ? err.message : '鏈煡閿欒');
      }

      // 娓呯悊
      if (websrRef.current.canvas && websrRef.current.canvas.parentNode) {
        websrRef.current.canvas.parentNode.removeChild(websrRef.current.canvas);
      }
      if (artPlayerRef.current?.video) {
        artPlayerRef.current.video.style.opacity = '1';
        artPlayerRef.current.video.style.position = '';
      }
      websrRef.current.canvas = null;
      websrRef.current.instance = null;
      websrRef.current.isActive = false;
    }
  };

  // 閿€姣乄ebSR
  const destroyWebSR = async () => {
    const ref = websrRef.current;
    ref.isActive = false;
    ref.renderLoopActive = false;

    try {
      if (ref.instance) {
        await ref.instance.destroy();
        ref.instance = null;
      }

      if (ref.canvas && ref.canvas.parentNode) {
        ref.canvas.parentNode.removeChild(ref.canvas);
        ref.canvas = null;
      }

      if (artPlayerRef.current?.video) {
        artPlayerRef.current.video.style.opacity = '1';
        artPlayerRef.current.video.style.position = '';
      }

      console.log('WebSR宸叉竻鐞?);
    } catch (err) {
      console.warn('娓呯悊WebSR鏃跺嚭閿?', err);
    }
  };

  // 鍒囨崲WebSR鐘舵€?  const toggleWebSR = async (enabled: boolean) => {
    try {
      if (enabled) {
        await initWebSR();
      } else {
        await destroyWebSR();
      }
      setWebsrEnabled(enabled);
      localStorage.setItem('websr_enabled', String(enabled));
    } catch (err) {
      console.error('鍒囨崲瓒呭垎鐘舵€佸け璐?', err);
    }
  };

  // 鍒囨崲WebSR閰嶇疆锛堟ā寮?缃戠粶澶у皬/鍐呭绫诲瀷鍙樺寲鏃讹級
  const switchWebSRConfig = async () => {
    if (!websrRef.current.isActive) return;

    try {
      // 濡傛灉 upscale <-> restore 鍒囨崲锛宑anvas 灏哄浼氬彉锛岄渶瑕佸畬鍏ㄩ噸寤?      const currentScale = websrRef.current.canvas ?
        (websrRef.current.canvas.width > (artPlayerRef.current?.video?.videoWidth || 0) ? 2 : 1) : 1;
      const newScale = websrModeRef.current === 'upscale' ? 2 : 1;

      if (currentScale !== newScale) {
        await destroyWebSR();
        await initWebSR();
        return;
      }

      // 鍚﹀垯鐑垏鎹㈢綉缁?      const networkName = getWebsrNetworkName(websrModeRef.current, websrNetworkSizeRef.current);
      const weightFile = getWebsrWeightFilename(
        websrModeRef.current,
        websrNetworkSizeRef.current,
        websrContentTypeRef.current
      );

      let weights = websrRef.current.weightsCache.get(weightFile);
      if (!weights) {
        const response = await fetch(`/ weights / anime4k / ${ weightFile } `);
        if (!response.ok) throw new Error(`鏉冮噸鏂囦欢鍔犺浇澶辫触: ${ weightFile } `);
        weights = await response.json();
        websrRef.current.weightsCache.set(weightFile, weights);
      }

      if (websrRef.current.instance && websrRef.current.instance.switchNetwork) {
        await websrRef.current.instance.switchNetwork(networkName, weights);

        if (artPlayerRef.current) {
          const modeText = websrModeRef.current === 'upscale' ? '2x瓒呭垎' : '闄嶅櫔';
          const sizeText = { s: '蹇€?, m: '鏍囧噯', l: '楂樿川' }[websrNetworkSizeRef.current];
          const typeText = { an: '鍔ㄦ极', rl: '鐪熶汉', '3d': '3D' }[websrContentTypeRef.current];
          artPlayerRef.current.notice.show = `宸插垏鎹 ? ${ modeText }, ${ sizeText }, ${ typeText } `;
        }
      }
    } catch (err) {
      console.error('鍒囨崲WebSR閰嶇疆澶辫触:', err);
      // 澶辫触鏃堕噸寤?      await destroyWebSR();
      await initWebSR();
    }
  };

  // 鍘诲箍鍛婄浉鍏冲嚱鏁?  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 濡傛灉鏈夎嚜瀹氫箟鍘诲箍鍛婁唬鐮侊紝浼樺厛浣跨敤
    const customCode = customAdFilterCodeRef.current;
    if (customCode && customCode.trim()) {
      try {
        // 绉婚櫎 TypeScript 绫诲瀷娉ㄨВ,杞崲涓虹函 JavaScript
        const jsCode = customCode
          .replace(/(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*([,)])/g, '$1$3')
          .replace(/\)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*\{/g, ') {')
          .replace(/(const|let|var)\s+(\w+)\s*:\s*(string|number|boolean|any|void|never|unknown|object)\s*=/g, '$1 $2 =');

        // 鍒涘缓骞舵墽琛岃嚜瀹氫箟鍑芥暟
        // eslint-disable-next-line no-new-func
        const customFunction = new Function('type', 'm3u8Content',
          jsCode + '\nreturn filterAdsFromM3U8(type, m3u8Content);'
        );
        const result = customFunction(currentSourceRef.current, m3u8Content);
        console.log('鉁?浣跨敤鑷畾涔夊幓骞垮憡浠ｇ爜');
        return result;
      } catch (err) {
        console.error('鎵ц鑷畾涔夊幓骞垮憡浠ｇ爜澶辫触,闄嶇骇浣跨敤榛樿瑙勫垯:', err);
        // 缁х画浣跨敤榛樿瑙勫垯
      }
    }

    // 榛樿鍘诲箍鍛婅鍒?    if (!m3u8Content) return '';

    // 骞垮憡鍏抽敭瀛楀垪琛?    const adKeywords = [
      'sponsor',
      '/ad/',
      '/ads/',
      'advert',
      'advertisement',
      '/adjump',
      'redtraffic'
    ];

    // 鎸夎鍒嗗壊M3U8鍐呭
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // 璺宠繃 #EXT-X-DISCONTINUITY 鏍囪瘑
      if (line.includes('#EXT-X-DISCONTINUITY')) {
        i++;
        continue;
      }

      // 濡傛灉鏄?EXTINF 琛岋紝妫€鏌ヤ笅涓€琛?URL 鏄惁鍖呭惈骞垮憡鍏抽敭瀛?      if (line.includes('#EXTINF:')) {
        // 妫€鏌ヤ笅涓€琛?URL 鏄惁鍖呭惈骞垮憡鍏抽敭瀛?        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const containsAdKeyword = adKeywords.some(keyword =>
            nextLine.toLowerCase().includes(keyword.toLowerCase())
          );

          if (containsAdKeyword) {
            // 璺宠繃 EXTINF 琛屽拰 URL 琛?            i += 2;
            continue;
          }
        }
      }

      // 淇濈暀褰撳墠琛?      filteredLines.push(line);
      i++;
    }

    return filteredLines.join('\n');
  }

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 涓嶅埌涓€灏忔椂锛屾牸寮忎负 00:00
      return `${ minutes.toString().padStart(2, '0') }:${
    remainingSeconds
      .toString()
    .padStart(2, '0')
  } `;
    } else {
      // 瓒呰繃涓€灏忔椂锛屾牸寮忎负 00:00:00
      return `${ hours.toString().padStart(2, '0') }:${
    minutes
      .toString()
    .padStart(2, '0')
  }:${ remainingSeconds.toString().padStart(2, '0') } `;
    }
  };


  useEffect(() => {
    // 馃敟 鏍囪姝ｅ湪鍒囨崲闆嗘暟锛堝彧鍦ㄩ潪鎹㈡簮鏃讹級
    if (!isSourceChangingRef.current) {
      isEpisodeChangingRef.current = true;
      // 馃攽 绔嬪嵆閲嶇疆 SkipController 瑙﹀彂鏍囧織锛屽厑璁告柊闆嗘暟鑷姩璺宠繃鐗囧ご鐗囧熬
      isSkipControllerTriggeredRef.current = false;
      videoEndedHandledRef.current = false;
      console.log('馃攧 寮€濮嬪垏鎹㈤泦鏁帮紝閲嶇疆鑷姩璺宠繃鏍囧織');
    }

    updateVideoUrl(detail, currentEpisodeIndex);

    // 馃殌 濡傛灉姝ｅ湪鎹㈡簮锛岃烦杩囧脊骞曞鐞嗭紙鎹㈡簮浼氬湪瀹屾垚鍚庢墜鍔ㄥ鐞嗭級
    if (isSourceChangingRef.current) {
      console.log('鈴笍 姝ｅ湪鎹㈡簮锛岃烦杩囧脊骞曞鐞?);
      return;
    }

    // 馃敟 鍏抽敭淇锛氶噸缃脊骞曞姞杞芥爣璇嗭紝纭繚鏂伴泦鏁拌兘姝ｇ‘鍔犺浇寮瑰箷
    lastDanmuLoadKeyRef.current = '';
    // 娓呴櫎涔嬪墠鐨勯泦鏁板垏鎹㈠畾鏃跺櫒锛岄槻姝㈤噸澶嶆墽琛?    if (episodeSwitchTimeoutRef.current) {
      clearTimeout(episodeSwitchTimeoutRef.current);
    }

    // 濡傛灉鎾斁鍣ㄥ凡缁忓瓨鍦ㄤ笖寮瑰箷鎻掍欢宸插姞杞斤紝閲嶆柊鍔犺浇寮瑰箷
      console.log('馃殌 闆嗘暟鍙樺寲锛屼紭鍖栧悗閲嶆柊鍔犺浇寮瑰箷');

      plugin.reset(); // 绔嬪嵆鍥炴敹鎵€鏈夋鍦ㄦ樉绀虹殑寮瑰箷DOM
      plugin.load(); // 涓嶄紶鍙傛暟锛屽畬鍏ㄦ竻绌哄脊骞曢槦鍒?      console.log('馃Ч 宸叉竻绌烘棫寮瑰箷鏁版嵁');

      };

      // 浣跨敤闃叉姈澶勭悊寮瑰箷閲嶆柊鍔犺浇
      episodeSwitchTimeoutRef.current = setTimeout(async () => {
        try {
          // 纭繚鎾斁鍣ㄥ拰鎻掍欢浠嶇劧瀛樺湪锛堥槻姝㈠揩閫熷垏鎹㈡椂鐨勭姸鎬佷笉涓€鑷达級
            console.warn('鈿狅笍 闆嗘暟鍒囨崲鍚庡脊骞曟彃浠朵笉瀛樺湪锛岃烦杩囧脊骞曞姞杞?);
            return;
          }

          console.log('馃攧 闆嗘暟鍙樺寲鍚庡閮ㄥ脊骞曞姞杞界粨鏋?', result.count, '鏉?);


            if (result.count > 0) {
              console.log('鉁?鍚戞挱鏀惧櫒鎻掍欢閲嶆柊鍔犺浇寮瑰箷鏁版嵁:', result.count, '鏉?);
              plugin.load(); // 娓呯┖宸叉湁寮瑰箷
              plugin.load(result.data);

                  plugin.show();
                }
              }

              if (artPlayerRef.current) {
                artPlayerRef.current.notice.show = `宸插姞杞 ? ${ result.count } 鏉″脊骞昤;
}
            } else {
  console.log('馃摥 闆嗘暟鍙樺寲鍚庢病鏈夊脊骞曟暟鎹彲鍔犺浇');
  plugin.load(); // 涓嶄紶鍙傛暟锛岀‘淇濇竻绌哄脊骞?
  if (artPlayerRef.current) {
    artPlayerRef.current.notice.show = '鏆傛棤寮瑰箷鏁版嵁';
  }
}
          }
        } catch (error) {
  console.error('鉂?闆嗘暟鍙樺寲鍚庡姞杞藉閮ㄥ脊骞曞け璐?', error);
} finally {
  // 娓呯悊瀹氭椂鍣ㄥ紩鐢?          episodeSwitchTimeoutRef.current = null;
}
      }, 800); // 缂╃煭寤惰繜鏃堕棿锛屾彁楂樺搷搴旀€?    }
  }, [detail, currentEpisodeIndex]);

// 杩涘叆椤甸潰鏃剁洿鎺ヨ幏鍙栧叏閮ㄦ簮淇℃伅
useEffect(() => {
  const fetchSourceDetail = async (
    source: string,
    id: string,
    title?: string
  ): Promise<SearchResult[]> => {
    try {
      let detailResponse;

      // 鍒ゆ柇鏄惁涓虹煭鍓ф簮
      if (source === 'shortdrama') {
        // 浼犻€?title 鍙傛暟浠ユ敮鎸佸鐢ˋPI fallback
        // 浼樺厛浣跨敤 URL 鍙傛暟鐨?title锛屽洜涓?videoTitleRef 鍙兘杩樻湭鍒濆鍖?          const dramaTitle = searchParams.get('title') || videoTitleRef.current || '';
        const titleParam = dramaTitle ? `&name=${encodeURIComponent(dramaTitle)}` : '';
        detailResponse = await fetch(
          `/api/shortdrama/detail?id=${id}&episode=1${titleParam}`
        );
      } else {
        // 鎵€鏈夊叾浠栨簮锛堝寘鎷?Emby锛夌粺涓€浣跨敤 /api/detail
        // 娣诲姞 title 鍙傛暟鐢ㄤ簬鎼滅储鍖归厤
        const titleParam = title ? `&title=${encodeURIComponent(title)}` : '';
        detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}${titleParam}`
        );
      }

      if (!detailResponse.ok) {
        throw new Error('鑾峰彇瑙嗛璇︽儏澶辫触');
      }

      const detailData = (await detailResponse.json()) as SearchResult;

      // 瀵逛簬鐭墽婧愶紝妫€鏌?title 鍜?poster 鏄惁鏈夋晥
      if (source === 'shortdrama') {
        if (!detailData.title || !detailData.poster) {
          throw new Error('鐭墽婧愭暟鎹笉瀹屾暣锛堢己灏戞爣棰樻垨娴锋姤锛?);
          }
      }

      // 娉ㄦ剰锛氫笉妫€鏌pisodes鏄惁涓虹┖锛屽洜涓烘湁浜涙簮鍙兘闇€瑕佸悗缁鐞?        // 鍗充娇episodes涓虹┖锛屼篃杩斿洖鏁版嵁锛岃璋冪敤鏂瑰喅瀹氬浣曞鐞?
      return [detailData];
    } catch (err) {
      console.error('鑾峰彇瑙嗛璇︽儏澶辫触:', err);
      return [];
    } finally {
      setSourceSearchLoading(false);
    }
  };
  const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
    // 浣跨敤鏅鸿兘鎼滅储鍙樹綋鑾峰彇鍏ㄩ儴婧愪俊鎭?      try {
    console.log('寮€濮嬫櫤鑳芥悳绱紝鍘熷鏌ヨ:', query);
    const searchVariants = generateSearchVariants(query.trim());
    console.log('鐢熸垚鐨勬悳绱㈠彉浣?', searchVariants);

    const allResults: SearchResult[] = [];
    let bestResults: SearchResult[] = [];

    // 渚濇灏濊瘯姣忎釜鎼滅储鍙樹綋锛岄噰鐢ㄦ棭鏈熼€€鍑虹瓥鐣?        for (const variant of searchVariants) {
    console.log('灏濊瘯鎼滅储鍙樹綋:', variant);

    const response = await fetch(
      `/api/search?q=${encodeURIComponent(variant)}`
    );
    if (!response.ok) {
      console.warn(`鎼滅储鍙樹綋 "${variant}" 澶辫触:`, response.statusText);
      continue;
    }
    const data = await response.json();

    if (data.results && data.results.length > 0) {
      allResults.push(...data.results);

      // 绉婚櫎鏃╂湡閫€鍑虹瓥鐣ワ紝璁ヾownstream鐨勭浉鍏虫€ц瘎鍒嗗彂鎸ヤ綔鐢?
      // 澶勭悊鎼滅储缁撴灉锛屼娇鐢ㄥ垎绾у尮閰嶏細绮剧‘鍖归厤浼樺厛锛岄伩鍏嶇煭鏍囬璇尮閰?            const queryTitle = videoTitleRef.current.replaceAll(' ', '').toLowerCase();

      const matchYearAndType = (result: SearchResult) => {
        const yearMatch = videoYearRef.current
          ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
          : true;
        const typeMatch = searchType
          ? (searchType === 'tv' && result.episodes.length > 1) ||
          (searchType === 'movie' && result.episodes.length === 1)
          : true;
        return yearMatch && typeMatch;
      };

      // 绗竴浼樺厛绾э細绮剧‘鍖归厤锛堟爣棰樺畬鍏ㄧ浉绛夛紝鎴栧幓闄ゆ暟瀛?鏍囩偣鍚庣浉绛夛級
      const exactResults = data.results.filter(
        (result: SearchResult) => {
          if (videoDoubanIdRef.current && videoDoubanIdRef.current > 0 && result.douban_id) {
            return result.douban_id === videoDoubanIdRef.current;
          }
          const resultTitle = result.title.replaceAll(' ', '').toLowerCase();
          const exactMatch = resultTitle === queryTitle ||
            resultTitle.replace(/\d+|[锛?]/g, '') === queryTitle.replace(/\d+|[锛?]/g, '');
          return exactMatch && matchYearAndType(result);
        }
      );

      // 绗簩浼樺厛绾э細瀹芥澗鍖呭惈鍖归厤锛堜粎褰撶簿纭尮閰嶆棤缁撴灉鏃朵娇鐢級
      let filteredResults = exactResults;
      if (exactResults.length === 0) {
        filteredResults = data.results.filter(
          (result: SearchResult) => {
            if (videoDoubanIdRef.current && videoDoubanIdRef.current > 0 && result.douban_id) {
              return result.douban_id === videoDoubanIdRef.current;
            }
            const resultTitle = result.title.replaceAll(' ', '').toLowerCase();
            const titleMatch = resultTitle.includes(queryTitle) ||
              queryTitle.includes(resultTitle) ||
              (queryTitle.length > 4 && checkAllKeywordsMatch(queryTitle, resultTitle));
            return titleMatch && matchYearAndType(result);
          }
        );
      }

      if (filteredResults.length > 0) {
        console.log(`鍙樹綋 "${variant}" 鎵惧埌 ${filteredResults.length} 涓尮閰嶇粨鏋滐紙${exactResults.length > 0 ? '绮剧‘' : '瀹芥澗'}鍖归厤锛塦);
              bestResults = filteredResults;
              break; // 鎵惧埌鍖归厤灏卞仠姝?            }
          }
        }
        
        // 鏅鸿兘鍖归厤锛氳嫳鏂囨爣棰樹弗鏍煎尮閰嶏紝涓枃鏍囬瀹芥澗鍖归厤
        let finalResults = bestResults;

        // 濡傛灉娌℃湁绮剧‘鍖归厤锛屾牴鎹瑷€绫诲瀷杩涜涓嶅悓绛栫暐鐨勫尮閰?        if (bestResults.length === 0) {
          const queryTitle = videoTitleRef.current.toLowerCase().trim();
          const allCandidates = allResults;

          // 妫€娴嬫煡璇富瑕佽瑷€锛堣嫳鏂?vs 涓枃锛?          const englishChars = (queryTitle.match(/[a-z\s]/g) || []).length;
          const chineseChars = (queryTitle.match(/[\u4e00-\u9fff]/g) || []).length;
          const isEnglishQuery = englishChars > chineseChars;

          console.log(`鎼滅储璇█妫€娴 ? ${ isEnglishQuery? '鑻辨枃': '涓枃' } - "${queryTitle}"`);

          let relevantMatches;

          if (isEnglishQuery) {
            // 鑻辨枃鏌ヨ锛氫娇鐢ㄨ瘝姹囧尮閰嶇瓥鐣ワ紝閬垮厤涓嶇浉鍏崇粨鏋?            console.log('浣跨敤鑻辨枃璇嶆眹鍖归厤绛栫暐');

            // 鎻愬彇鏈夋晥鑻辨枃璇嶆眹锛堣繃婊ゅ仠鐢ㄨ瘝锛?            const queryWords = queryTitle.toLowerCase()
              .replace(/[^\w\s]/g, ' ')
              .split(/\s+/)
              .filter(word => word.length > 2 && !['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by'].includes(word));

            console.log('鑻辨枃鍏抽敭璇?', queryWords);

            relevantMatches = allCandidates.filter(result => {
              const title = result.title.toLowerCase();
              const titleWords = title.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(word => word.length > 1);

              // 璁＄畻璇嶆眹鍖归厤搴︼細鏍囬蹇呴』鍖呭惈鑷冲皯50%鐨勬煡璇㈠叧閿瘝
              const matchedWords = queryWords.filter(queryWord =>
                titleWords.some(titleWord =>
                  titleWord.includes(queryWord) || queryWord.includes(titleWord) ||
                  // 鍏佽閮ㄥ垎鐩镐技锛堝gumball vs gum锛?                  (queryWord.length > 4 && titleWord.length > 4 &&
                   queryWord.substring(0, 4) === titleWord.substring(0, 4))
                )
              );

              const wordMatchRatio = matchedWords.length / queryWords.length;
              if (wordMatchRatio >= 0.5) {
                console.log(`鑻辨枃璇嶆眹鍖归厤(${ matchedWords.length } / ${ queryWords.length }): "${result.title}" - 鍖归厤璇 ? [${ matchedWords.join(', ') }]`);
                return true;
              }
              return false;
            });
          } else {
            // 涓枃鏌ヨ锛氬鏉惧尮閰嶏紝淇濇寔鐜版湁琛屼负
            console.log('浣跨敤涓枃鍖归厤绛栫暐锛堢簿纭紭鍏堬級');
            const normalizedQuery = queryTitle.replace(/[^\w\u4e00-\u9fff]/g, '');

            // 鍏堝皾璇曠簿纭尮閰?            const exactChinese = allCandidates.filter(result => {
              const normalizedTitle = result.title.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
              const isExact = normalizedTitle === normalizedQuery ||
                normalizedTitle.replace(/\d+/g, '') === normalizedQuery.replace(/\d+/g, '');
              if (isExact) console.log(`涓枃绮剧‘鍖归厤: "${result.title}"`);
              return isExact;
            });

            if (exactChinese.length > 0) {
              relevantMatches = exactChinese;
            } else {
              // 绮剧‘鏃犵粨鏋滐紝闄嶇骇鍒板寘鍚尮閰?              relevantMatches = allCandidates.filter(result => {
                const title = result.title.toLowerCase();
                const normalizedTitle = title.replace(/[^\w\u4e00-\u9fff]/g, '');

                if (normalizedTitle.includes(normalizedQuery) || normalizedQuery.includes(normalizedTitle)) {
                  console.log(`涓枃鍖呭惈鍖归厤: "${result.title}"`);
                  return true;
                }

                const commonChars = Array.from(normalizedQuery).filter(char => normalizedTitle.includes(char)).length;
                const similarity = commonChars / normalizedQuery.length;
                if (similarity >= 0.5) {
                  console.log(`涓枃鐩镐技鍖归厤(${(similarity * 100).toFixed(1)}%): "${result.title}"`);
                  return true;
                }
                return false;
              });
            }
          }

          console.log(`鍖归厤缁撴灉: ${ relevantMatches.length }/${allCandidates.length}`);

// 濡傛灉鏈夊尮閰嶇粨鏋滐紝鐩存帴杩斿洖锛堝幓閲嶏級
if (relevantMatches.length > 0) {
  finalResults = Array.from(
    new Map(relevantMatches.map(item => [`${item.source}-${item.id}`, item])).values()
  ) as SearchResult[];
  console.log(`鎵惧埌 ${finalResults.length} 涓敮涓€鍖归厤缁撴灉`);
} else {
  console.log('娌℃湁鎵惧埌鍚堢悊鐨勫尮閰嶏紝杩斿洖绌虹粨鏋?);
            finalResults = [];
}
        }

console.log(`鏅鸿兘鎼滅储瀹屾垚锛屾渶缁堣繑鍥?${finalResults.length} 涓粨鏋渀);
        // 鎸夋潈閲嶆帓搴忓悗璁剧疆鍙敤婧愬垪琛?        const sortedResults = await setAvailableSourcesWithWeight(finalResults);
        return sortedResults;
      } catch (err) {
        console.error('鏅鸿兘鎼滅储澶辫触:', err);
        setSourceSearchError(err instanceof Error ? err.message : '鎼滅储澶辫触');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缂哄皯蹇呰鍙傛暟');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '馃幀 姝ｅ湪鑾峰彇瑙嗛璇︽儏...'
          : '馃攳 姝ｅ湪鎼滅储鎾斁婧?..'
      );

      let detailData: SearchResult | null = null;
      let sourcesInfo: SearchResult[] = [];

      // 濡傛灉宸茬粡鏈変簡source鍜宨d锛屼紭鍏堥€氳繃鍗曚釜璇︽儏鎺ュ彛蹇€熻幏鍙?      if (currentSource && currentId) {
        // 鍏堝揩閫熻幏鍙栧綋鍓嶆簮鐨勮鎯?        try {
          console.log('[Play] 鑾峰彇褰撳墠婧愯鎯?', currentSource, currentId);
          const currentSourceDetail = await fetchSourceDetail(
            currentSource,
            currentId,
            searchTitle || videoTitle
          );
          console.log('[Play] 鑾峰彇鍒扮殑璇︽儏:', currentSourceDetail);
          if (currentSourceDetail.length > 0) {
            detailData = currentSourceDetail[0];
            sourcesInfo = currentSourceDetail;
            console.log('[Play] 璁剧疆 detailData 鍜?sourcesInfo 鎴愬姛');
          } else {
            console.error('[Play] fetchSourceDetail 杩斿洖绌烘暟缁?);
          }
        } catch (err) {
          console.error('鑾峰彇褰撳墠婧愯鎯呭け璐?', err);
        }

        // 寮傛鑾峰彇鍏朵粬婧愪俊鎭紝涓嶉樆濉炴挱鏀?        setBackgroundSourcesLoading(true);
        fetchSourcesData(searchTitle || videoTitle).then((sources) => {
          // 鍚堝苟褰撳墠婧愬拰鎼滅储鍒扮殑鍏朵粬婧?          const allSources = [...sourcesInfo];
          sources.forEach((source) => {
            // 閬垮厤閲嶅娣诲姞褰撳墠婧?            if (!(source.source === currentSource && source.id === currentId)) {
              allSources.push(source);
            }
          });
          setAvailableSources(allSources);
          setBackgroundSourcesLoading(false);
        }).catch((err) => {
          console.error('寮傛鑾峰彇鍏朵粬婧愬け璐?', err);
          setBackgroundSourcesLoading(false);
        });
      } else {
        // 娌℃湁source鍜宨d锛屾甯告悳绱㈡祦绋?        sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      }

      if (!detailData && sourcesInfo.length === 0) {
        setError('鏈壘鍒板尮閰嶇粨鏋?);
        setLoading(false);
        return;
      }

      if (!detailData) {
        detailData = sourcesInfo[0];
      }
      // 鎸囧畾婧愬拰id涓旀棤闇€浼橀€?      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) => source.source === currentSource && source.id === currentId
        );
        if (target) {
          detailData = target;

          // 濡傛灉鏄?emby 婧愪笖 episodes 涓虹┖锛岄渶瑕佽皟鐢?detail 鎺ュ彛鑾峰彇瀹屾暣淇℃伅
          if ((detailData.source === 'emby' || detailData.source.startsWith('emby_')) && (!detailData.episodes || detailData.episodes.length === 0)) {
            console.log('[Play] Emby source has no episodes, fetching detail...');
            const detailSources = await fetchSourceDetail(currentSource, currentId, searchTitle || videoTitle);
            if (detailSources.length > 0) {
              detailData = detailSources[0];
            }
          }
        } else {
          setError('鏈壘鍒板尮閰嶇粨鏋?);
          setLoading(false);
          return;
        }
      }

      // 鏈寚瀹氭簮鍜?id 鎴栭渶瑕佷紭閫夛紝涓斿紑鍚紭閫夊紑鍏?      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('鈿?姝ｅ湪浼橀€夋渶浣虫挱鏀炬簮...');

        // 杩囨护鎺?emby 婧愶紝瀹冧滑涓嶅弬涓庢祴閫?        const sourcesToTest = sourcesInfo.filter(s => {
          // 妫€鏌ユ槸鍚︿负 emby 婧愶紙鍖呮嫭 emby 鍜?emby_xxx 鏍煎紡锛?          if (s.source === 'emby' || s.source.startsWith('emby_')) return false;
          return true;
        });

        const excludedSources = sourcesInfo.filter(s =>
          s.source === 'emby' || s.source.startsWith('emby_')
        );

        if (sourcesToTest.length > 0) {
          detailData = await preferBestSource(sourcesToTest);
        } else if (excludedSources.length > 0) {
          // 濡傛灉鍙湁 emby 婧愶紝鐩存帴浣跨敤绗竴涓?          detailData = excludedSources[0];
        } else {
          detailData = sourcesInfo[0];
        }
      }

      if (!detailData) {
        setError('鏈壘鍒板尮閰嶇粨鏋?);
        setLoading(false);
        return;
      }

      console.log(detailData.source, detailData.id);

      // 濡傛灉鏄?emby 婧愪笖 episodes 涓虹┖锛岄渶瑕佽皟鐢?detail 鎺ュ彛鑾峰彇瀹屾暣淇℃伅
      if ((detailData.source === 'emby' || detailData.source.startsWith('emby_')) && (!detailData.episodes || detailData.episodes.length === 0)) {
        console.log('[Play] Emby source has no episodes, fetching detail...');
        const detailSources = await fetchSourceDetail(detailData.source, detailData.id, detailData.title || videoTitleRef.current);
        if (detailSources.length > 0) {
          detailData = detailSources[0];
        }
      }

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      // 浼樺厛淇濈暀URL鍙傛暟涓殑璞嗙摚ID锛屽鏋淯RL涓病鏈夊垯浣跨敤璇︽儏鏁版嵁涓殑
      setVideoDoubanId(videoDoubanIdRef.current || detailData.douban_id || 0);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 瑙勮寖URL鍙傛暟
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('鉁?鍑嗗灏辩华锛屽嵆灏嗗紑濮嬫挱鏀?..');

      // 鐭殏寤惰繜璁╃敤鎴风湅鍒板畬鎴愮姸鎬?      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, [reloadTrigger]); // 娣诲姞 reloadTrigger 浣滀负渚濊禆锛屽綋瀹冨彉鍖栨椂閲嶆柊鎵ц initAll

  // 鎾斁璁板綍澶勭悊
  useEffect(() => {
    // 浠呭湪鍒濇鎸傝浇鏃舵鏌ユ挱鏀捐褰?    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      // 馃敟 鍏抽敭淇锛氫紭鍏堟鏌?sessionStorage 涓殑涓存椂杩涘害锛堟崲婧愭椂淇濆瓨鐨勶級
      const tempProgressKey = `temp_progress_${ currentSource }_${ currentId }_${ currentEpisodeIndex }`;
      const tempProgress = sessionStorage.getItem(tempProgressKey);

      if (tempProgress) {
        const savedTime = parseFloat(tempProgress);
        if (savedTime > 1) {
          resumeTimeRef.current = savedTime;
          console.log(`馃幆 浠 ? sessionStorage 鎭㈠鎹㈡簮鍓嶇殑鎾斁杩涘害: ${ savedTime.toFixed(2) }s`);
          // 绔嬪嵆娓呴櫎涓存椂杩涘害锛岄伩鍏嶉噸澶嶆仮澶?          sessionStorage.removeItem(tempProgressKey);
          return; // 浼樺厛浣跨敤涓存椂杩涘害锛屼笉鍐嶈鍙栧巻鍙茶褰?        }
      }

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 鏇存柊褰撳墠閫夐泦绱㈠紩
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 淇濆瓨寰呮仮澶嶇殑鎾斁杩涘害锛屽緟鎾斁鍣ㄥ氨缁悗璺宠浆
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('璇诲彇鎾斁璁板綍澶辫触:', err);
      }
    };

    initFromHistory();
  }, []);

  // 馃殌 浼樺寲鐨勬崲婧愬鐞嗭紙闃茶繛缁偣鍑伙級
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string
  ) => {
    try {
      // 闃叉杩炵画鐐瑰嚮鎹㈡簮
      if (isSourceChangingRef.current) {
        console.log('鈴革笍 姝ｅ湪鎹㈡簮涓紝蹇界暐閲嶅鐐瑰嚮');
        return;
      }

      // 馃殌 璁剧疆鎹㈡簮鏍囪瘑锛岄槻姝seEffect閲嶅澶勭悊寮瑰箷
      isSourceChangingRef.current = true;

      // 鏄剧ず鎹㈡簮鍔犺浇鐘舵€?      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 馃殌 绔嬪嵆閲嶇疆寮瑰箷鐩稿叧鐘舵€侊紝閬垮厤娈嬬暀
      lastDanmuLoadKeyRef.current = '';

      // 娓呴櫎闆嗘暟鍒囨崲瀹氭椂鍣?      if (episodeSwitchTimeoutRef.current) {
        clearTimeout(episodeSwitchTimeoutRef.current);
        episodeSwitchTimeoutRef.current = null;
      }


        try {
          // 馃殌 姝ｇ‘娓呯┖寮瑰箷锛氬厛reset鍥炴敹DOM锛屽啀load娓呯┖闃熷垪
          if (typeof plugin.reset === 'function') {
            plugin.reset(); // 绔嬪嵆鍥炴敹鎵€鏈夋鍦ㄦ樉绀虹殑寮瑰箷DOM
          }

          if (typeof plugin.load === 'function') {
            // 鍏抽敭锛歭oad()涓嶄紶鍙傛暟浼氳Е鍙戞竻绌洪€昏緫锛坉anmuku === undefined锛?            plugin.load();
            console.log('鉁?宸插畬鍏ㄦ竻绌哄脊骞曢槦鍒?);
          }

          // 鐒跺悗闅愯棌寮瑰箷灞?          if (typeof plugin.hide === 'function') {
            plugin.hide();
          }

          console.log('馃Ч 鎹㈡簮鏃跺凡娓呯┖鏃у脊骞曟暟鎹?);
        } catch (error) {
          console.warn('娓呯┖寮瑰箷鏃跺嚭閿欙紝浣嗙户缁崲婧?', error);
        }
      }

      // 璁板綍褰撳墠鎾斁杩涘害锛堜粎鍦ㄥ悓涓€闆嗘暟鍒囨崲鏃舵仮澶嶏級
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('鎹㈡簮鍓嶅綋鍓嶆挱鏀炬椂闂?', currentPlayTime);

      // 馃敟 鍏抽敭淇锛氬皢鎾斁杩涘害淇濆瓨鍒?sessionStorage锛岄槻姝㈢粍浠堕噸鏂版寕杞芥椂涓㈠け
      // 浣跨敤涓存椂鐨?key锛屽湪鏂扮粍浠舵寕杞藉悗绔嬪嵆璇诲彇骞舵竻闄?      if (currentPlayTime > 1) {
        const tempProgressKey = `temp_progress_${ newSource }_${ newId }_${ currentEpisodeIndex }`;
        sessionStorage.setItem(tempProgressKey, currentPlayTime.toString());
        console.log(`馃捑 宸蹭繚瀛樹复鏃舵挱鏀捐繘搴﹀埌 sessionStorage: ${ tempProgressKey } = ${ currentPlayTime.toFixed(2) }s`);
      }

      // 娓呴櫎鍓嶄竴涓巻鍙茶褰?      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
          console.log('宸叉竻闄ゅ墠涓€涓挱鏀捐褰?);
        } catch (err) {
          console.error('娓呴櫎鎾斁璁板綍澶辫触:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId
      );
      if (!newDetail) {
        setError('鏈壘鍒板尮閰嶇粨鏋?);
        return;
      }

      // 濡傛灉鏄?emby 婧愪笖 episodes 涓虹┖锛岄渶瑕佽皟鐢?detail 鎺ュ彛鑾峰彇瀹屾暣淇℃伅
      let detailToUse = newDetail;
      if ((newDetail.source === 'emby' || newDetail.source.startsWith('emby_')) && (!newDetail.episodes || newDetail.episodes.length === 0)) {
        console.log('[Play] Emby source has no episodes after switch, fetching detail...');
        try {
          const { source: apiSource, embyKey } = parseSourceForApi(newSource);
          const embyKeyParam = embyKey ? `& embyKey=${ embyKey }` : '';
          const detailResponse = await fetch(`/ api / emby / detail ? id = ${ newId }${ embyKeyParam }`);
          if (detailResponse.ok) {
            const detailSources = (await detailResponse.json()) as SearchResult[];
            if (detailSources.length > 0) {
              detailToUse = detailSources[0];
            }
          }
        } catch (err) {
          console.error('[Play] Failed to fetch Emby detail:', err);
        }
      }

      // 馃敟 鎹㈡簮鏃朵繚鎸佸綋鍓嶉泦鏁颁笉鍙橈紙闄ら潪鏂版簮闆嗘暟涓嶅锛?      let targetIndex = currentEpisodeIndex;

      // 鍙湁褰撴柊婧愮殑闆嗘暟涓嶅鏃舵墠璋冩暣鍒版渶鍚庝竴闆嗘垨绗竴闆?      if (detailToUse.episodes && detailToUse.episodes.length > 0) {
        if (targetIndex >= detailToUse.episodes.length) {
          // 褰撳墠闆嗘暟瓒呭嚭鏂版簮鑼冨洿锛岃烦杞埌鏂版簮鐨勬渶鍚庝竴闆?          targetIndex = detailToUse.episodes.length - 1;
          console.log(`鈿狅笍 褰撳墠闆嗘暟(${ currentEpisodeIndex })瓒呭嚭鏂版簮鑼冨洿(${ detailToUse.episodes.length }闆 ? 锛岃烦杞埌绗 ? { targetIndex + 1}闆哷);
// 馃敟 闆嗘暟鍙樺寲鏃讹紝娓呴櫎淇濆瓨鐨勪复鏃惰繘搴?          const tempProgressKey = `temp_progress_${newSource}_${newId}_${currentEpisodeIndex}`;
sessionStorage.removeItem(tempProgressKey);
        } else {
  // 闆嗘暟鍦ㄨ寖鍥村唴锛屼繚鎸佷笉鍙?          console.log(`鉁?鎹㈡簮淇濇寔褰撳墠闆嗘暟: 绗?{targetIndex + 1}闆哷);
}
      }

// 馃敟 鐢变簬缁勪欢浼氶噸鏂版寕杞斤紝涓嶅啀闇€瑕佽缃?resumeTimeRef锛堣繘搴﹀凡淇濆瓨鍒?sessionStorage锛?      // 缁勪欢閲嶆柊鎸傝浇鍚庝細鑷姩浠?sessionStorage 鎭㈠杩涘害

// 鏇存柊URL鍙傛暟锛堜笉鍒锋柊椤甸潰锛?      const newUrl = new URL(window.location.href);
newUrl.searchParams.set('source', newSource);
newUrl.searchParams.set('id', newId);
newUrl.searchParams.set('year', detailToUse.year);
newUrl.searchParams.set('index', targetIndex.toString());  // 馃敟 鍚屾URL鐨刬ndex鍙傛暟
window.history.replaceState({}, '', newUrl.toString());

setVideoTitle(detailToUse.title || newTitle);
setVideoYear(detailToUse.year);
setVideoCover(detailToUse.poster);
// 浼樺厛淇濈暀URL鍙傛暟涓殑璞嗙摚ID锛屽鏋淯RL涓病鏈夊垯浣跨敤璇︽儏鏁版嵁涓殑
setVideoDoubanId(videoDoubanIdRef.current || detailToUse.douban_id || 0);
setCurrentSource(newSource);
setCurrentId(newId);
setDetail(detailToUse);

// 馃敟 鍙湁褰撻泦鏁扮‘瀹炴敼鍙樻椂鎵嶈皟鐢?setCurrentEpisodeIndex
// 杩欐牱鍙互閬垮厤瑙﹀彂涓嶅繀瑕佺殑 useEffect 鍜岄泦鏁板垏鎹㈤€昏緫
if (targetIndex !== currentEpisodeIndex) {
  setCurrentEpisodeIndex(targetIndex);
}

// 馃殌 鎹㈡簮瀹屾垚鍚庯紝浼樺寲寮瑰箷鍔犺浇娴佺▼
setTimeout(async () => {
  isSourceChangingRef.current = false; // 閲嶇疆鎹㈡簮鏍囪瘑

    console.log('馃攧 鎹㈡簮瀹屾垚锛屽紑濮嬩紭鍖栧脊骞曞姞杞?..');

    // 纭繚鐘舵€佸畬鍏ㄩ噸缃?          lastDanmuLoadKeyRef.current = '';

    try {
      const startTime = performance.now();


        // 馃殌 纭繚鍦ㄥ姞杞芥柊寮瑰箷鍓嶅畬鍏ㄦ竻绌烘棫寮瑰箷
        plugin.reset(); // 绔嬪嵆鍥炴敹鎵€鏈夋鍦ㄦ樉绀虹殑寮瑰箷DOM
        plugin.load(); // 涓嶄紶鍙傛暟锛屽畬鍏ㄦ竻绌洪槦鍒?              console.log('馃Ч 鎹㈡簮鍚庡凡娓呯┖鏃у脊骞曪紝鍑嗗鍔犺浇鏂板脊骞?);

        // 馃殌 浼樺寲澶ч噺寮瑰箷鐨勫姞杞斤細鍒嗘壒澶勭悊锛屽噺灏戦樆濉?              if (result.count > 1000) {
        console.log(`馃搳 妫€娴嬪埌澶ч噺寮瑰箷 (${result.count}鏉?锛屽惎鐢ㄥ垎鎵瑰姞杞絗);

                // 鍏堝姞杞藉墠500鏉★紝蹇€熸樉绀?                const firstBatch = result.data.slice(0, 500);
                plugin.load(firstBatch);

                // 鍓╀綑寮瑰箷鍒嗘壒寮傛鍔犺浇锛岄伩鍏嶉樆濉?                const remainingBatches = [];
                for (let i = 500; i < result.data.length; i += 300) {
                  remainingBatches.push(result.data.slice(i, i + 300));
                }

                // 浣跨敤requestIdleCallback鍒嗘壒鍔犺浇鍓╀綑寮瑰箷
                remainingBatches.forEach((batch, index) => {
                  setTimeout(() => {
                      // 灏嗘壒娆″脊骞曡拷鍔犲埌鐜版湁闃熷垪
                      batch.forEach(danmu => {
                        plugin.emit(danmu).catch(console.warn);
                      });
                    }
                  }, (index + 1) * 100); // 姣?00ms鍔犺浇涓€鎵?                });

                console.log(`鈿 ? 鍒嗘壒鍔犺浇瀹屾垚 : 棣栨壒${ firstBatch.length }鏉 ? + ${ remainingBatches.length }涓悗缁壒娆);
      } else {
        // 寮瑰箷鏁伴噺杈冨皯锛屾甯稿姞杞?                plugin.load(result.data);
        console.log(`鉁?鎹㈡簮鍚庡脊骞曞姞杞藉畬鎴? ${result.count} 鏉);
              }

              const loadTime = performance.now() - startTime;
              console.log(`鈴憋笍 寮瑰箷鍔犺浇鑰楁椂: ${ loadTime.toFixed(2) }ms`);
            } else {
              console.log('馃摥 鎹㈡簮鍚庢病鏈夊脊骞曟暟鎹?);
            }
          } catch (error) {
            console.error('鉂?鎹㈡簮鍚庡脊骞曞姞杞藉け璐?', error);
          }
        }
      }, 1000); // 鍑忓皯鍒?绉掑欢杩燂紝鍔犲揩鍝嶅簲

    } catch (err) {
      // 閲嶇疆鎹㈡簮鏍囪瘑
      isSourceChangingRef.current = false;

      // 闅愯棌鎹㈡簮鍔犺浇鐘舵€?      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '鎹㈡簮澶辫触');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // 馃殌 缁勪欢鍗歌浇鏃舵竻鐞嗘墍鏈夊畾鏃跺櫒鍜岀姸鎬?  useEffect(() => {
    return () => {
      // 娓呯悊鎵€鏈夊畾鏃跺櫒
      if (episodeSwitchTimeoutRef.current) {
        clearTimeout(episodeSwitchTimeoutRef.current);
      }
      if (sourceSwitchTimeoutRef.current) {
        clearTimeout(sourceSwitchTimeoutRef.current);
      }

      // 閲嶇疆鐘舵€?      isSourceChangingRef.current = false;
      switchPromiseRef.current = null;
      pendingSwitchRef.current = null;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 闆嗘暟鍒囨崲
  // ---------------------------------------------------------------------------
  // 澶勭悊闆嗘暟鍒囨崲
  const handleEpisodeChange = async (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 鍦ㄦ洿鎹㈤泦鏁板墠淇濆瓨褰撳墠鎾斁杩涘害
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }

      // 馃敟 浼樺寲锛氭鏌ョ洰鏍囬泦鏁版槸鍚︽湁鍘嗗彶鎾斁璁板綍
      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSourceRef.current, currentIdRef.current);
        const record = allRecords[key];

        // 濡傛灉鍘嗗彶璁板綍鐨勯泦鏁颁笌鐩爣闆嗘暟鍖归厤锛屼笖鏈夋挱鏀捐繘搴?        if (record && record.index - 1 === episodeNumber && record.play_time > 0) {
          resumeTimeRef.current = record.play_time;
          console.log(`馃幆 鍒囨崲鍒扮${ episodeNumber + 1} 闆嗭紝鎭㈠鍘嗗彶杩涘害: ${ record.play_time.toFixed(2) } s`);
        } else {
          resumeTimeRef.current = 0;
          console.log(`馃攧 鍒囨崲鍒扮${ episodeNumber + 1 } 闆嗭紝浠庡ご鎾斁`);
        }
      } catch (err) {
        console.warn('璇诲彇鍘嗗彶璁板綍澶辫触:', err);
        resumeTimeRef.current = 0;
      }

      // 馃敟 浼樺寲锛氬悓姝ユ洿鏂癠RL鍙傛暟锛屼繚鎸乁RL涓庡疄闄呮挱鏀剧姸鎬佷竴鑷?      try {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('index', episodeNumber.toString());
        window.history.replaceState({}, '', newUrl.toString());
      } catch (err) {
        console.warn('鏇存柊URL鍙傛暟澶辫触:', err);
      }

      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      // 馃敟 鍏抽敭淇锛氶€氳繃 SkipController 鑷姩璺充笅涓€闆嗘椂锛屼笉淇濆瓨鎾斁杩涘害
      // 鍥犱负姝ゆ椂鐨勬挱鏀句綅缃槸鐗囧熬锛岀敤鎴峰苟娌℃湁鐪熸鐪嬪埌杩欎釜浣嶇疆
      // 濡傛灉淇濆瓨浜嗙墖灏剧殑杩涘害锛屼笅娆?缁х画瑙傜湅"浼氫粠鐗囧熬寮€濮嬶紝瀵艰嚧杩涘害閿欒
      // if (artPlayerRef.current && !artPlayerRef.current.paused) {
      //   saveCurrentPlayProgress();
      // }

      // 馃攽 鏍囪閫氳繃 SkipController 瑙﹀彂浜嗕笅涓€闆?      isSkipControllerTriggeredRef.current = true;
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 閿洏蹇嵎閿?  // ---------------------------------------------------------------------------
  // 澶勭悊鍏ㄥ眬蹇嵎閿?  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 蹇界暐杈撳叆妗嗕腑鐨勬寜閿簨浠?    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 宸︾澶?= 涓婁竴闆?    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 鍙崇澶?= 涓嬩竴闆?    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 宸︾澶?= 蹇€€
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 鍙崇澶?= 蹇繘
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

    // 涓婄澶?= 闊抽噺+
    if (e.key === 'ArrowUp') {
      if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `闊抽噺: ${
        Math.round(
          artPlayerRef.current.volume * 100
        )
      } `;
        e.preventDefault();
      }
    }

    // 涓嬬澶?= 闊抽噺-
    if (e.key === 'ArrowDown') {
      if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
        artPlayerRef.current.volume =
          Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
        artPlayerRef.current.notice.show = `闊抽噺: ${
        Math.round(
          artPlayerRef.current.volume * 100
        )
      } `;
        e.preventDefault();
      }
    }

    // 绌烘牸 = 鎾斁/鏆傚仠
    if (e.key === ' ') {
      if (artPlayerRef.current) {
        artPlayerRef.current.toggle();
        e.preventDefault();
      }
    }

    // f 閿?= 鍒囨崲鍏ㄥ睆
    if (e.key === 'f' || e.key === 'F') {
      if (artPlayerRef.current) {
        artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
        e.preventDefault();
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 鎾斁璁板綍鐩稿叧
  // ---------------------------------------------------------------------------
  // 淇濆瓨鎾斁杩涘害
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 濡傛灉鎾斁鏃堕棿澶煭锛堝皯浜?绉掞級鎴栬€呰棰戞椂闀挎棤鏁堬紝涓嶄繚瀛?    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      // 鑾峰彇鐜版湁鎾斁璁板綍浠ヤ繚鎸佸師濮嬮泦鏁?      const existingRecord = await getAllPlayRecords().then(records => {
        const key = generateStorageKey(currentSourceRef.current, currentIdRef.current);
        return records[key];
      }).catch(() => null);

      const currentTotalEpisodes = detailRef.current?.episodes.length || 1;

      // 灏濊瘯浠庢崲婧愬垪琛ㄤ腑鑾峰彇鏇村噯纭殑 remarks锛堟悳绱㈡帴鍙ｆ瘮璇︽儏鎺ュ彛鏇村彲鑳芥湁 remarks锛?      const sourceFromList = availableSourcesRef.current?.find(
        s => s.source === currentSourceRef.current && s.id === currentIdRef.current
      );
      const remarksToSave = sourceFromList?.remarks || detailRef.current?.remarks;

      savePlayRecordMutation.mutate({
        source: currentSourceRef.current,
        id: currentIdRef.current,
        record: {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          index: currentEpisodeIndexRef.current + 1,
          total_episodes: currentTotalEpisodes,
          original_episodes: existingRecord?.original_episodes,
          play_time: Math.floor(currentTime),
          total_time: Math.floor(duration),
          save_time: Date.now(),
          search_title: searchTitle,
          remarks: remarksToSave,
          douban_id: videoDoubanIdRef.current || detailRef.current?.douban_id || undefined,
          type: searchType || undefined,
        },
      });

      lastSaveTimeRef.current = Date.now();
      console.log('鎾斁杩涘害宸蹭繚瀛?', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${ Math.floor(currentTime) }/${Math.floor(duration)}`,
    });
    } catch (err) {
  console.error('淇濆瓨鎾斁杩涘害澶辫触:', err);
}
  };

useEffect(() => {
  // 椤甸潰鍗冲皢鍗歌浇鏃朵繚瀛樻挱鏀捐繘搴﹀拰娓呯悊璧勬簮
  const handleBeforeUnload = () => {
    saveCurrentPlayProgress();
    releaseWakeLock();
    cleanupPlayer(); // 涓峚wait锛岃瀹冨紓姝ユ墽琛?    };

    // 椤甸潰鍙鎬у彉鍖栨椂淇濆瓨鎾斁杩涘害鍜岄噴鏀?Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 椤甸潰閲嶆柊鍙鏃讹紝濡傛灉姝ｅ湪鎾斁鍒欓噸鏂拌姹?Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 娣诲姞浜嬩欢鐩戝惉鍣?    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 娓呯悊浜嬩欢鐩戝惉鍣?      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

// 娓呯悊瀹氭椂鍣?  useEffect(() => {
return () => {
  if (saveIntervalRef.current) {
    clearInterval(saveIntervalRef.current);
  }
};
  }, []);

// ---------------------------------------------------------------------------
// 鏀惰棌鐩稿叧
// ---------------------------------------------------------------------------
// 姣忓綋 source 鎴?id 鍙樺寲鏃舵鏌ユ敹钘忕姸鎬侊紙鏀寔璞嗙摚/Bangumi绛夎櫄鎷熸簮锛?  useEffect(() => {
if (!currentSource || !currentId) return;
(async () => {
  try {
    const favorites = await getAllFavorites();

    // 妫€鏌ュ涓彲鑳界殑鏀惰棌key
    const possibleKeys = [
      `${currentSource}+${currentId}`, // 褰撳墠鐪熷疄鎾斁婧?          videoDoubanId ? `douban+${videoDoubanId}` : null, // 璞嗙摚鏀惰棌
      videoDoubanId ? `bangumi+${videoDoubanId}` : null, // Bangumi鏀惰棌
      shortdramaId ? `shortdrama+${shortdramaId}` : null, // 鐭墽鏀惰棌
    ].filter(Boolean);

    // 妫€鏌ユ槸鍚︿换涓€key宸茶鏀惰棌
    const fav = possibleKeys.some(key => !!favorites[key as string]);
    setFavorited(fav);
  } catch (err) {
    console.error('妫€鏌ユ敹钘忕姸鎬佸け璐?', err);
  }
})();
  }, [currentSource, currentId, videoDoubanId, shortdramaId]);

// 鐩戝惉鏀惰棌鏁版嵁鏇存柊浜嬩欢锛堟敮鎸佽眴鐡?Bangumi绛夎櫄鎷熸簮锛?  useEffect(() => {
if (!currentSource || !currentId) return;

const unsubscribe = subscribeToDataUpdates(
  'favoritesUpdated',
  (favorites: Record<string, any>) => {
    // 妫€鏌ュ涓彲鑳界殑鏀惰棌key
    const possibleKeys = [
      generateStorageKey(currentSource, currentId), // 褰撳墠鐪熷疄鎾斁婧?          videoDoubanId ? `douban+${videoDoubanId}` : null, // 璞嗙摚鏀惰棌
      videoDoubanId ? `bangumi+${videoDoubanId}` : null, // Bangumi鏀惰棌
      shortdramaId ? `shortdrama+${shortdramaId}` : null, // 鐭墽鏀惰棌
    ].filter(Boolean);

    // 妫€鏌ユ槸鍚︿换涓€key宸茶鏀惰棌
    const isFav = possibleKeys.some(key => !!favorites[key as string]);
    setFavorited(isFav);
  }
);

return unsubscribe;
  }, [currentSource, currentId, videoDoubanId, shortdramaId]);

// 鑷姩鏇存柊鏀惰棌鐨勯泦鏁板拰鐗囨簮淇℃伅锛堟敮鎸佽眴鐡?Bangumi/鐭墽绛夎櫄鎷熸簮锛?  useEffect(() => {
if (!detail || !currentSource || !currentId) return;

const updateFavoriteData = async () => {
  try {
    const realEpisodes = detail.episodes.length || 1;
    const favorites = await getAllFavorites();

    // 妫€鏌ュ涓彲鑳界殑鏀惰棌key
    const possibleKeys = [
      `${currentSource}+${currentId}`, // 褰撳墠鐪熷疄鎾斁婧?          videoDoubanId ? `douban+${videoDoubanId}` : null, // 璞嗙摚鏀惰棌
      videoDoubanId ? `bangumi+${videoDoubanId}` : null, // Bangumi鏀惰棌
    ].filter(Boolean);

    let favoriteToUpdate = null;
    let favoriteKey = '';

    // 鎵惧埌宸插瓨鍦ㄧ殑鏀惰棌
    for (const key of possibleKeys) {
      if (favorites[key as string]) {
        favoriteToUpdate = favorites[key as string];
        favoriteKey = key as string;
        break;
      }
    }

    if (!favoriteToUpdate) return;

    // 妫€鏌ユ槸鍚﹂渶瑕佹洿鏂帮紙闆嗘暟涓嶅悓鎴栫己灏戠墖婧愪俊鎭級
    const needsUpdate =
      favoriteToUpdate.total_episodes === 99 ||
      favoriteToUpdate.total_episodes !== realEpisodes ||
      !favoriteToUpdate.source_name ||
      favoriteToUpdate.source_name === '鍗冲皢涓婃槧' ||
      favoriteToUpdate.source_name === '璞嗙摚' ||
      favoriteToUpdate.source_name === 'Bangumi';

    if (needsUpdate) {
      console.log(`馃攧 鏇存柊鏀惰棌鏁版嵁: ${favoriteKey}`, {
        鏃ч泦鏁? favoriteToUpdate.total_episodes,
        鏂伴泦鏁? realEpisodes,
        鏃х墖婧? favoriteToUpdate.source_name,
        鏂扮墖婧? detail.source_name,
      });

      // 鎻愬彇鏀惰棌key涓殑source鍜宨d
      const [favSource, favId] = favoriteKey.split('+');

      // 鏍规嵁 type_name 鎺ㄦ柇鍐呭绫诲瀷
      const inferType = (typeName?: string): string | undefined => {
        if (!typeName) return undefined;
        const lowerType = typeName.toLowerCase();
        if (lowerType.includes('鐭墽') || lowerType.includes('shortdrama') || lowerType.includes('short-drama') || lowerType.includes('short drama')) return 'shortdrama';
        if (lowerType.includes('缁艰壓') || lowerType.includes('variety')) return 'variety';
        if (lowerType.includes('鐢靛奖') || lowerType.includes('movie')) return 'movie';
        if (lowerType.includes('鐢佃鍓?) || lowerType.includes('鍓ч泦') || lowerType.includes('tv') || lowerType.includes('series')) return 'tv';
            if (lowerType.includes('鍔ㄦ极') || lowerType.includes('鍔ㄧ敾') || lowerType.includes('anime')) return 'anime';
        if (lowerType.includes('绾綍鐗?) || lowerType.includes('documentary')) return 'documentary';
            return undefined;
      };

      // 纭畾鍐呭绫诲瀷锛氫紭鍏堜娇鐢ㄥ凡鏈夌殑 type锛屽鏋滄病鏈夊垯鎺ㄦ柇
      let contentType = favoriteToUpdate.type || inferType(detail.type_name);
      // 濡傛灉杩樻槸鏃犳硶纭畾绫诲瀷锛屾鏌?source 鏄惁涓?shortdrama
      if (!contentType && favSource === 'shortdrama') {
        contentType = 'shortdrama';
      }

      saveFavoriteMutation.mutate({
        source: favSource,
        id: favId,
        favorite: {
          title: videoTitleRef.current || detail.title || favoriteToUpdate.title,
          source_name: detail.source_name || favoriteToUpdate.source_name || '',
          year: detail.year || favoriteToUpdate.year || '',
          cover: detail.poster || favoriteToUpdate.cover || '',
          total_episodes: realEpisodes,
          save_time: favoriteToUpdate.save_time || Date.now(),
          search_title: favoriteToUpdate.search_title || searchTitle,
          releaseDate: favoriteToUpdate.releaseDate,
          remarks: favoriteToUpdate.remarks,
          type: contentType,
        },
      });

      console.log('鉁?鏀惰棌鏁版嵁鏇存柊鎴愬姛');
    }
  } catch (err) {
    console.error('鑷姩鏇存柊鏀惰棌鏁版嵁澶辫触:', err);
  }
};

updateFavoriteData();
  }, [detail, currentSource, currentId, videoDoubanId, searchTitle]);

// 鍒囨崲鏀惰棌
const handleToggleFavorite = async () => {
  if (
    !videoTitleRef.current ||
    !detailRef.current ||
    !currentSourceRef.current ||
    !currentIdRef.current
  )
    return;

  if (favorited) {
    // 濡傛灉宸叉敹钘忥紝鍒犻櫎鏀惰棌
    deleteFavoriteMutation.mutate(
      {
        source: currentSourceRef.current,
        id: currentIdRef.current,
      },
      {
        onSuccess: () => {
          setFavorited(false);
        },
        onError: (err) => {
          console.error('鍒犻櫎鏀惰棌澶辫触:', err);
        },
      }
    );
  } else {
    // 鏍规嵁 type_name 鎺ㄦ柇鍐呭绫诲瀷
    const inferType = (typeName?: string): string | undefined => {
      if (!typeName) return undefined;
      const lowerType = typeName.toLowerCase();
      if (lowerType.includes('鐭墽') || lowerType.includes('shortdrama') || lowerType.includes('short-drama') || lowerType.includes('short drama')) return 'shortdrama';
      if (lowerType.includes('缁艰壓') || lowerType.includes('variety')) return 'variety';
      if (lowerType.includes('鐢靛奖') || lowerType.includes('movie')) return 'movie';
      if (lowerType.includes('鐢佃鍓?) || lowerType.includes('鍓ч泦') || lowerType.includes('tv') || lowerType.includes('series')) return 'tv';
        if (lowerType.includes('鍔ㄦ极') || lowerType.includes('鍔ㄧ敾') || lowerType.includes('anime')) return 'anime';
      if (lowerType.includes('绾綍鐗?) || lowerType.includes('documentary')) return 'documentary';
        return undefined;
    };

    // 鏍规嵁 source 鎴?type_name 纭畾鍐呭绫诲瀷
    let contentType = inferType(detailRef.current?.type_name);
    // 濡傛灉 type_name 鏃犳硶鎺ㄦ柇绫诲瀷锛屾鏌?source 鏄惁涓?shortdrama
    if (!contentType && currentSourceRef.current === 'shortdrama') {
      contentType = 'shortdrama';
    }

    // 濡傛灉鏈敹钘忥紝娣诲姞鏀惰棌
    saveFavoriteMutation.mutate(
      {
        source: currentSourceRef.current,
        id: currentIdRef.current,
        favorite: {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
          type: contentType,
        },
      },
      {
        onSuccess: () => {
          setFavorited(true);
        },
        onError: (err) => {
          console.error('娣诲姞鏀惰棌澶辫触:', err);
        },
      }
    );
  }
};

useEffect(() => {
  // initialize video player (Shaka) dynamically
  const initPlayer = async () => {
    if (
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // ensure episode index valid
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log('[shaka] url', videoUrl);

    // cleanup existing Shaka instance and video element
    if (shakaPlayerRef.current) {
      try {
        shakaPlayerRef.current.destroy();
      } catch { }
      shakaPlayerRef.current = null;
    }
    if (videoRef.current && videoRef.current.parentElement) {
      videoRef.current.parentElement.removeChild(videoRef.current);
      videoRef.current = null;
    }

    // create new video element
    const videoEl = document.createElement('video');
    videoEl.className = 'w-full h-full';
    videoEl.controls = true;
    videoEl.playsInline = true;
    videoEl.autoplay = true;
    videoEl.muted = false;
    artRef.current.appendChild(videoEl);
    videoRef.current = videoEl;

    try {
      let Shaka = (window as any).DynamicShaka;
      if (!Shaka) {
        const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
        Shaka = shakaModule.default || shakaModule;
        (window as any).DynamicShaka = Shaka;
      }

      const player: shaka.Player = new Shaka.Player(videoEl);
      shakaPlayerRef.current = player;

      player.configure({
        streaming: { rebufferingGoal: 15, bufferingGoal: 30 },
        manifest: { retryParameters: { maxAttempts: 3, baseDelay: 1000, backoffFactor: 2 } },
      });

      player.addEventListener('error', (evt: any) => {
        console.error('shaka-player error', evt);
        setError('播放错误');
      });

      await player.load(videoUrl);
      setPlayerReady(true);

      // shim object exposing minimal ArtPlayer-like API
      artPlayerRef.current = new Proxy({
        video: videoEl,
        plugins: {},
        notice: { show: (msg: string) => toast(msg) },
        destroy: () => {
          player.destroy();
        },
        layers: { 'fullscreen-title': { show: () => { }, hide: () => { } } },
      } as any, {
        get(target, prop) {
          // transparently proxy common properties to video element
          if (prop in target) return (target as any)[prop];
          switch (prop) {
            case 'currentTime':
              return videoEl.currentTime;
            case 'duration':
              return videoEl.duration;
            case 'paused':
              return videoEl.paused;
            case 'volume':
              return videoEl.volume;
            case 'playbackRate':
              return videoEl.playbackRate;
          }
          return undefined;
        },
        set(target, prop, value) {
          switch (prop) {
            case 'currentTime':
              videoEl.currentTime = value;
              return true;
            case 'volume':
              videoEl.volume = value;
              return true;
            case 'playbackRate':
              videoEl.playbackRate = value;
              return true;
          }
          (target as any)[prop] = value;
          return true;
        },
      });
    } catch (err) {
      console.error('Shaka init failed:', err);
      setError('播放器初始化失败');
    }
  };

  initPlayer();
}, [videoUrl, loading, blockAdEnabled]);
/* LEGACY CODE REMOVED - begin
const isIOS = isIOSGlobal;
const isIOS13 = isIOS13Global;
const isMobile = isMobileGlobal;
const isWebKit = isSafari || isIOS;
// Chrome娴忚鍣ㄦ娴?- 鍙湁鐪熸鐨凜hrome鎵嶆敮鎸丆hromecast
// 鎺掗櫎鍚勭鍘傚晢娴忚鍣紝鍗充娇瀹冧滑鐨刄A鍖呭惈Chrome瀛楁牱
const isChrome = /Chrome/i.test(userAgent) && 
                !/Edg/i.test(userAgent) &&      // 鎺掗櫎Edge
                !/OPR/i.test(userAgent) &&      // 鎺掗櫎Opera
                !/SamsungBrowser/i.test(userAgent) && // 鎺掗櫎涓夋槦娴忚鍣?                    !/OPPO/i.test(userAgent) &&     // 鎺掗櫎OPPO娴忚鍣?                    !/OppoBrowser/i.test(userAgent) && // 鎺掗櫎OppoBrowser
                !/HeyTapBrowser/i.test(userAgent) && // 鎺掗櫎HeyTapBrowser (OPPO鏂扮増娴忚鍣?
                !/OnePlus/i.test(userAgent) &&  // 鎺掗櫎OnePlus娴忚鍣?                    !/Xiaomi/i.test(userAgent) &&   // 鎺掗櫎灏忕背娴忚鍣?                    !/MIUI/i.test(userAgent) &&     // 鎺掗櫎MIUI娴忚鍣?                    !/Huawei/i.test(userAgent) &&   // 鎺掗櫎鍗庝负娴忚鍣?                    !/Vivo/i.test(userAgent) &&     // 鎺掗櫎Vivo娴忚鍣?                    !/UCBrowser/i.test(userAgent) && // 鎺掗櫎UC娴忚鍣?                    !/QQBrowser/i.test(userAgent) && // 鎺掗櫎QQ娴忚鍣?                    !/Baidu/i.test(userAgent) &&    // 鎺掗櫎鐧惧害娴忚鍣?                    !/SogouMobileBrowser/i.test(userAgent); // 鎺掗櫎鎼滅嫍娴忚鍣?
// 璋冭瘯淇℃伅锛氳緭鍑鸿澶囨娴嬬粨鏋滃拰鎶曞睆绛栫暐
console.log('馃攳 璁惧妫€娴嬬粨鏋?', {
  userAgent,
  isIOS,
  isSafari,
  isMobile,
  isWebKit,
  isChrome,
  'AirPlay鎸夐挳': isIOS || isSafari ? '鉁?鏄剧ず' : '鉂?闅愯棌',
  'Chromecast鎸夐挳': isChrome && !isIOS ? '鉁?鏄剧ず' : '鉂?闅愯棌',
  '鎶曞睆绛栫暐': isIOS || isSafari ? '馃崕 AirPlay (WebKit)' : isChrome ? '馃摵 Chromecast (Cast API)' : '鉂?涓嶆敮鎸佹姇灞?
});

// 馃殌 浼樺寲杩炵画鍒囨崲锛氶槻鎶栨満鍒?+ 璧勬簮绠＄悊
if (artPlayerRef.current && !loading) {
  try {
    // 娓呴櫎涔嬪墠鐨勫垏鎹㈠畾鏃跺櫒
    if (sourceSwitchTimeoutRef.current) {
      clearTimeout(sourceSwitchTimeoutRef.current);
      sourceSwitchTimeoutRef.current = null;
    }

    // 濡傛灉鏈夋鍦ㄨ繘琛岀殑鍒囨崲锛屽厛鍙栨秷
    if (switchPromiseRef.current) {
      console.log('鈴革笍 鍙栨秷鍓嶄竴涓垏鎹㈡搷浣滐紝寮€濮嬫柊鐨勫垏鎹?);
      // ArtPlayer娌℃湁鎻愪緵鍙栨秷鏈哄埗锛屼絾鎴戜滑鍙互蹇界暐鏃х殑缁撴灉
      switchPromiseRef.current = null;
    }

      };
    }

    // 馃殌 鍏抽敭淇锛氬尯鍒嗘崲婧愬拰鍒囨崲闆嗘暟
    const isEpisodeChange = isEpisodeChangingRef.current;
    const currentTime = artPlayerRef.current.currentTime || 0;

    let switchPromise: Promise<any>;
    if (isEpisodeChange) {
      console.log(`馃幆 寮€濮嬪垏鎹㈤泦鏁? ${videoUrl} (閲嶇疆鎾斁鏃堕棿鍒?)`);
      // 鍒囨崲闆嗘暟鏃堕噸缃挱鏀炬椂闂村埌0
      switchPromise = artPlayerRef.current.switchUrl(videoUrl);
    } else {
      console.log(`馃幆 寮€濮嬪垏鎹㈡簮: ${videoUrl} (淇濇寔杩涘害: ${currentTime.toFixed(2)}s)`);
      // 鎹㈡簮鏃朵繚鎸佹挱鏀捐繘搴?          switchPromise = artPlayerRef.current.switchQuality(videoUrl);
    }

    // 鍒涘缓鍒囨崲Promise
    switchPromise = switchPromise.then(() => {
      // 鍙湁褰撳墠Promise杩樻槸娲昏穬鐨勬墠鎵ц鍚庣画鎿嶄綔
      if (switchPromiseRef.current === switchPromise) {
        artPlayerRef.current.title = `${videoTitle} - 绗?{currentEpisodeIndex + 1}闆哷;
        artPlayerRef.current.poster = videoCover;
        console.log('鉁?婧愬垏鎹㈠畬鎴?);

        // 馃敟 閲嶇疆闆嗘暟鍒囨崲鏍囪瘑
        if (isEpisodeChange) {
          // 馃攽 鍏抽敭淇锛氬垏鎹㈤泦鏁板悗鏄惧紡閲嶇疆鎾斁鏃堕棿涓?0锛岀‘淇濈墖澶磋嚜鍔ㄨ烦杩囪兘瑙﹀彂
          artPlayerRef.current.currentTime = 0;
          console.log('馃幆 闆嗘暟鍒囨崲瀹屾垚锛岄噸缃挱鏀炬椂闂翠负 0');
          isEpisodeChangingRef.current = false;
        }
      }
    }).catch((error: any) => {
      if (switchPromiseRef.current === switchPromise) {
        console.warn('鈿狅笍 婧愬垏鎹㈠け璐ワ紝灏嗛噸寤烘挱鏀惧櫒:', error);
        // 閲嶇疆闆嗘暟鍒囨崲鏍囪瘑
        if (isEpisodeChange) {
          isEpisodeChangingRef.current = false;
        }
        throw error; // 璁╁灞俢atch澶勭悊
      }
    });

    switchPromiseRef.current = switchPromise;
    await switchPromise;
    
    if (artPlayerRef.current?.video) {
      ensureVideoSource(
        artPlayerRef.current.video as HTMLVideoElement,
        videoUrl
      );
    }
    
    // 馃殌 绉婚櫎鍘熸湁鐨?setTimeout 寮瑰箷鍔犺浇閫昏緫锛屼氦鐢?useEffect 缁熶竴浼樺寲澶勭悊
    
    console.log('浣跨敤switch鏂规硶鎴愬姛鍒囨崲瑙嗛');
    return;
  } catch (error) {
    console.warn('Switch鏂规硶澶辫触锛屽皢閲嶅缓鎾斁鍣?', error);
    // 閲嶇疆闆嗘暟鍒囨崲鏍囪瘑
    isEpisodeChangingRef.current = false;
    // 濡傛灉switch澶辫触锛屾竻鐞嗘挱鏀惧櫒骞堕噸鏂板垱寤?        await cleanupPlayer();
  }
}
if (artPlayerRef.current) {
  await cleanupPlayer();
}

// 纭繚 DOM 瀹瑰櫒瀹屽叏娓呯┖锛岄伩鍏嶅瀹炰緥鍐茬獊
if (artRef.current) {
  artRef.current.innerHTML = '';
}

try {
  // 浣跨敤鍔ㄦ€佸鍏ョ殑 Artplayer
  const Artplayer = (window as any).DynamicArtplayer;
  
  // 鍒涘缓鏂扮殑鎾斁鍣ㄥ疄渚?      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  Artplayer.USE_RAF = false;
  Artplayer.FULLSCREEN_WEB_IN_BODY = true;
  // 閲嶆柊鍚敤5.3.0鍐呭瓨浼樺寲鍔熻兘锛屼絾浣跨敤false鍙傛暟閬垮厤娓呯┖DOM
  Artplayer.REMOVE_SRC_WHEN_DESTROY = true;

  artPlayerRef.current = new Artplayer({
    container: artRef.current,
    url: videoUrl,
    poster: videoCover,
    volume: 0.7,
    isLive: false,
    // iOS璁惧闇€瑕侀潤闊虫墠鑳借嚜鍔ㄦ挱鏀撅紝鍙傝€傾rtPlayer婧愮爜澶勭悊
    muted: isIOS || isSafari,
    autoplay: true,
    pip: true,
    autoSize: false,
    autoMini: false,
    screenshot: !isMobile, // 妗岄潰绔惎鐢ㄦ埅鍥惧姛鑳?        setting: true,
    loop: false,
    flip: false,
    playbackRate: true,
    aspectRatio: false,
    fullscreen: true,
    fullscreenWeb: true,
    subtitleOffset: false,
    miniProgressBar: false,
    mutex: true,
    playsInline: true,
    autoPlayback: false,
    theme: '#22c55e',
    lang: 'zh-cn',
    hotkey: false,
    fastForward: true,
    autoOrientation: true,
    lock: true,
    // AirPlay 浠呭湪鏀寔 WebKit API 鐨勬祻瑙堝櫒涓惎鐢?        // 涓昏鏄?Safari (妗岄潰鍜岀Щ鍔ㄧ) 鍜?iOS 涓婄殑鍏朵粬娴忚鍣?        airplay: isIOS || isSafari,
    moreVideoAttr: {
      crossOrigin: 'anonymous',
    },
    // HLS 鏀寔閰嶇疆
    customType: {
      m3u8: function (video: HTMLVideoElement, url: string) {
        if (!Hls) {
          console.error('HLS.js 鏈姞杞?);
          return;
        }

        if (video.hls) {
          video.hls.destroy();
        }
        
        // 鍦ㄥ嚱鏁板唴閮ㄩ噸鏂版娴媔OS13+璁惧
        const localIsIOS13 = isIOS13;

        // 鑾峰彇鐢ㄦ埛鐨勭紦鍐叉ā寮忛厤缃?            const bufferConfig = getHlsBufferConfig();

        // 馃殌 鏍规嵁 HLS.js 瀹樻柟婧愮爜鐨勬渶浣冲疄璺甸厤缃?            const hls = new Hls({
          debug: false,
          enableWorker: true,
          // 鍙傝€?HLS.js config.ts锛氱Щ鍔ㄨ澶囧叧闂綆寤惰繜妯″紡浠ヨ妭鐪佽祫婧?              lowLatencyMode: !isMobile,

          // 馃幆 瀹樻柟鎺ㄨ崘鐨勭紦鍐茬瓥鐣?- iOS13+ 鐗瑰埆浼樺寲
          /* 缂撳啿闀垮害閰嶇疆 - 鍙傝€?hlsDefaultConfig - 妗岄潰璁惧搴旂敤鐢ㄦ埛閰嶇疆 */
maxBufferLength: isMobile
  ? (localIsIOS13 ? 8 : isIOS ? 10 : 15)  // iOS13+: 8s, iOS: 10s, Android: 15s
  : bufferConfig.maxBufferLength, // 妗岄潰浣跨敤鐢ㄦ埛閰嶇疆
  backBufferLength: isMobile
    ? (localIsIOS13 ? 5 : isIOS ? 8 : 10)   // iOS13+鏇翠繚瀹?                : bufferConfig.backBufferLength, // 妗岄潰浣跨敤鐢ㄦ埛閰嶇疆

              /* 缂撳啿澶у皬閰嶇疆 - 鍩轰簬瀹樻柟 maxBufferSize - 妗岄潰璁惧搴旂敤鐢ㄦ埛閰嶇疆 */
              maxBufferSize: isMobile
  ? (localIsIOS13 ? 20 * 1000 * 1000 : isIOS ? 30 * 1000 * 1000 : 40 * 1000 * 1000) // iOS13+: 20MB, iOS: 30MB, Android: 40MB
  : bufferConfig.maxBufferSize, // 妗岄潰浣跨敤鐢ㄦ埛閰嶇疆

  /* 缃戠粶鍔犺浇浼樺寲 - 鍙傝€?defaultLoadPolicy */
  maxLoadingDelay: isMobile ? (localIsIOS13 ? 2 : 3) : 4, // iOS13+璁惧鏇村揩瓒呮椂
    maxBufferHole: isMobile ? (localIsIOS13 ? 0.05 : 0.1) : 0.1, // 鍑忓皯缂撳啿娲炲蹇嶅害

      /* Fragment绠＄悊 - 鍙傝€冨畼鏂归厤缃?*/
      liveDurationInfinity: false, // 閬垮厤鏃犻檺缂撳啿 (瀹樻柟榛樿false)
        liveBackBufferLength: isMobile ? (localIsIOS13 ? 3 : 5) : null, // 宸插簾寮冿紝淇濇寔鍏煎

          /* 楂樼骇浼樺寲閰嶇疆 - 鍙傝€?StreamControllerConfig */
          maxMaxBufferLength: isMobile ? (localIsIOS13 ? 60 : 120) : 600, // 鏈€澶х紦鍐查暱搴﹂檺鍒?              maxFragLookUpTolerance: isMobile ? 0.1 : 0.25, // 鐗囨鏌ユ壘瀹瑰繊搴?              
            /* ABR浼樺寲 - 鍙傝€?ABRControllerConfig */
            abrEwmaFastLive: isMobile ? 2 : 3, // 绉诲姩绔洿蹇殑鐮佺巼鍒囨崲
              abrEwmaSlowLive: isMobile ? 6 : 9,
                abrBandWidthFactor: isMobile ? 0.8 : 0.95, // 绉诲姩绔洿淇濆畧鐨勫甫瀹戒及璁?              
                  /* 鍚姩浼樺寲 */
                  startFragPrefetch: !isMobile, // 绉诲姩绔叧闂鍙栦互鑺傜渷璧勬簮
                    testBandwidth: !localIsIOS13, // iOS13+鍏抽棴甯﹀娴嬭瘯浠ュ揩閫熷惎鍔?              
                      /* Loader閰嶇疆 - 鍙傝€冨畼鏂?fragLoadPolicy */
                      fragLoadPolicy: {
                default: {
    maxTimeToFirstByteMs: isMobile ? 6000 : 10000,
      maxLoadTimeMs: isMobile ? 60000 : 120000,
        timeoutRetry: {
      maxNumRetry: isMobile ? 2 : 4,
        retryDelayMs: 0,
          maxRetryDelayMs: 0,
                  },
    errorRetry: {
      maxNumRetry: isMobile ? 3 : 6,
        retryDelayMs: 1000,
          maxRetryDelayMs: isMobile ? 4000 : 8000,
                  },
  },
},

/* 鑷畾涔塴oader */
loader: blockAdEnabledRef.current
  ? CustomHlsJsLoader
  : Hls.DefaultConfig.loader,
            });

hls.loadSource(url);
hls.attachMedia(video);
video.hls = hls;

ensureVideoSource(video, url);

hls.on(Hls.Events.ERROR, function (event: any, data: any) {
  console.error('HLS Error:', event, data);

  // v1.6.15 鏀硅繘锛氫紭鍖栦簡鎾斁鍒楄〃鏈熬绌虹墖娈?闂撮殭澶勭悊锛屾敼杩涗簡闊抽TS鐗囨duration澶勭悊
  // v1.6.13 澧炲己锛氬鐞嗙墖娈佃В鏋愰敊璇紙閽堝initPTS淇锛?              if (data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
  console.log('鐗囨瑙ｆ瀽閿欒锛屽皾璇曢噸鏂板姞杞?..');
  // 閲嶆柊寮€濮嬪姞杞斤紝鍒╃敤v1.6.13鐨刬nitPTS淇
  hls.startLoad();
  return;
}

              // v1.6.13 澧炲己锛氬鐞嗘椂闂存埑鐩稿叧閿欒锛堢洿鎾洖鎼滀慨澶嶏級
              if (data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR &&
  data.err && data.err.message &&
  data.err.message.includes('timestamp')) {
  console.log('鏃堕棿鎴抽敊璇紝娓呯悊缂撳啿鍖哄苟閲嶆柊鍔犺浇...');
  try {
    // 娓呯悊缂撳啿鍖哄悗閲嶆柊寮€濮嬶紝鍒╃敤v1.6.13鐨勬椂闂存埑鍖呰淇
    const currentTime = video.currentTime;
    hls.trigger(Hls.Events.BUFFER_RESET, undefined);
    hls.startLoad(currentTime);
  } catch (e) {
    console.warn('缂撳啿鍖洪噸缃け璐?', e);
    hls.startLoad();
  }
  return;
}

if (data.fatal) {
  switch (data.type) {
    case Hls.ErrorTypes.NETWORK_ERROR:
      console.log('缃戠粶閿欒锛屽皾璇曟仮澶?..');
      hls.startLoad();
      break;
    case Hls.ErrorTypes.MEDIA_ERROR:
      console.log('濯掍綋閿欒锛屽皾璇曟仮澶?..');
      hls.recoverMediaError();
      break;
    default:
      console.log('鏃犳硶鎭㈠鐨勯敊璇?);
                    hls.destroy();
      break;
  }
}
            });
          },
        },
icons: {
  loading:
  '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
settings: [
  {
    html: '鍘诲箍鍛?,
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
    tooltip: blockAdEnabled ? '宸插紑鍚? : '宸插叧闂?,
    onClick() {
      const newVal = !blockAdEnabled;
      try {
        localStorage.setItem('enable_blockad', String(newVal));
        if (artPlayerRef.current) {
          resumeTimeRef.current = artPlayerRef.current.currentTime;
          if (artPlayerRef.current.video.hls) {
            artPlayerRef.current.video.hls.destroy();
          }
          artPlayerRef.current.destroy(false);
          artPlayerRef.current = null;
        }
        setBlockAdEnabled(newVal);
      } catch (_) {
        // ignore
      }
      return newVal ? '褰撳墠寮€鍚? : '褰撳墠鍏抽棴';
    },
  },
  {
    name: '澶栭儴寮瑰箷',
    html: '澶栭儴寮瑰箷',
    icon: '<text x="50%" y="50%" font-size="14" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">澶?/text>',
    tooltip: ? '澶栭儴寮瑰箷宸插紑鍚? : '澶栭儴寮瑰箷宸插叧闂?,
    switch:,
    onSwitch: function (item: any) {
      const nextState = !item.switch;

      // 馃殌 浣跨敤浼樺寲鍚庣殑寮瑰箷鎿嶄綔澶勭悊鍑芥暟

      // 鏇存柊tooltip鏄剧ず
      item.tooltip = nextState ? '澶栭儴寮瑰箷宸插紑鍚? : '澶栭儴寮瑰箷宸插叧闂 ?;

      return nextState; // 绔嬪嵆杩斿洖鏂扮姸鎬?            },
    },
          {
    name: '寮瑰箷璁剧疆',
    html: '寮瑰箷璁剧疆',
    tooltip: '鎵撳紑寮瑰箷璁剧疆闈㈡澘',
    icon: '<text x="50%" y="50%" font-size="14" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">寮?/text>',
    // 馃帹 鐐瑰嚮寮忔寜閽紝鎵撳紑缇庡寲鐨勫脊骞曡缃潰鏉?            onClick: function () {
              // 鍏抽棴settings鑿滃崟
              if(artPlayerRef.current) {
    artPlayerRef.current.setting.show = false;
  }
              // 鉁?蹇呴』杩斿洖tooltip鏂囨湰锛屽惁鍒橝rtPlayer浼氳缃负undefined
              return '鎵撳紑寮瑰箷璁剧疆闈㈡澘';
            },
          },
          ...(webGPUSupported ? [
  {
    name: '瓒呭垎璁剧疆',
    html: '瓒呭垎璁剧疆',
    icon: '<text x="50%" y="50%" font-size="14" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">瓒?/text>',
    tooltip: '鎵撳紑AI瓒呭垎璁剧疆闈㈡澘',
    onClick: function () {
      setIsWebSRSettingsPanelOpen(true);
      if (artPlayerRef.current) {
        artPlayerRef.current.setting.show = false;
      }
      return '鎵撳紑AI瓒呭垎璁剧疆闈㈡澘';
    },
  },
] : []),
        ],
// 鎺у埗鏍忛厤缃?        controls: [
{
  position: 'left',
    index: 13,
      html: '<i class="art-icon flex hint--top" aria-label="鎾斁涓嬩竴闆?><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
        tooltip: '鎾斁涓嬩竴闆?,
  click: function () {
    handleNextEpisode();
  },
},
          // 馃殌 绠€鍗曞脊骞曞彂閫佹寜閽紙浠匴eb绔樉绀猴級
          ...(isMobile ? [] : [{
  position: 'right',
  html: '<span class="hint--top" aria-label="鍙戦€佸脊骞?>寮?/span>',
  tooltip: '鍙戦€佸脊骞?,
            click: function () {
      // 鎵嬪姩寮瑰嚭杈撳叆妗嗗彂閫佸脊骞?                const text = prompt('璇疯緭鍏ュ脊骞曞唴瀹?, '');
      if (text && text.trim()) {
          text: text.trim(),
          time: artPlayerRef.current.currentTime,
          color: '#FFFFFF',
          mode: 0,
        });
      }
    }
  },
}]),
        ],
// 馃殌 鎬ц兘浼樺寲鐨勫脊骞曟彃浠堕厤缃?- 淇濇寔寮瑰箷鏁伴噺锛屼紭鍖栨覆鏌撴€ц兘
plugins: [
    // 馃幆 璁惧鎬ц兘妫€娴?            const getDevicePerformance = () => {
    const hardwareConcurrency = navigator.hardwareConcurrency || 2
    const memory = (performance as any).memory?.jsHeapSizeLimit || 0

    // 绠€鍗曟€ц兘璇勫垎锛?-1锛?              let score = 0
    score += Math.min(hardwareConcurrency / 4, 1) * 0.5 // CPU鏍稿績鏁版潈閲?              score += Math.min(memory / (1024 * 1024 * 1024), 1) * 0.3 // 鍐呭瓨鏉冮噸
    score += (isMobile ? 0.2 : 0.5) * 0.2 // 璁惧绫诲瀷鏉冮噸

    if (score > 0.7) return 'high'
    if (score > 0.4) return 'medium'
    return 'low'
  }
            
            const devicePerformance = getDevicePerformance()
console.log(`馃幆 璁惧鎬ц兘绛夌骇: ${devicePerformance}`)

// 馃殌 婵€杩涙€ц兘浼樺寲锛氶拡瀵瑰ぇ閲忓脊骞曠殑娓叉煋绛栫暐
const getOptimizedConfig = () => {
  const baseConfig = {
    danmuku: [], // 鍒濆涓虹┖鏁扮粍锛屽悗缁€氳繃load鏂规硶鍔犺浇
    speed: parseFloat(localStorage.getItem('danmaku_speed') || '5'),
    opacity: parseFloat(localStorage.getItem('danmaku_opacity') || '0.8'),
    fontSize: parseInt(localStorage.getItem('danmaku_fontSize') || '25'),
    color: '#FFFFFF',
    mode: 0 as const,
    modes: JSON.parse(localStorage.getItem('danmaku_modes') || '[0, 1, 2]') as Array<0 | 1 | 2>,
    margin: JSON.parse(localStorage.getItem('danmaku_margin') || '[10, "75%"]') as [number | `${number}%`, number | `${number}%`],
    visible: localStorage.getItem('danmaku_visible') !== 'false',
    emitter: false,
    maxLength: 50,
    lockTime: 1, // 馃幆 杩涗竴姝ュ噺灏戦攣瀹氭椂闂达紝鎻愬崌杩涘害璺宠浆鍝嶅簲
    theme: 'dark' as const,
    width: 300,

                // 馃幆 婵€杩涗紭鍖栭厤缃?- 淇濇寔鍔熻兘瀹屾暣鎬?                antiOverlap: localStorage.getItem('danmaku_antiOverlap') !== null
                  ? localStorage.getItem('danmaku_antiOverlap') === 'true'
    : (devicePerformance === 'high'), // 榛樿鍊硷細楂樻€ц兘璁惧寮€鍚槻閲嶅彔
    synchronousPlayback: true, // 鉁?蹇呴』淇濇寔true锛佺‘淇濆脊骞曚笌瑙嗛鎾斁閫熷害鍚屾
    heatmap: false, // 鍏抽棴鐑姏鍥撅紝鍑忓皯DOM璁＄畻寮€閿€

  // 馃 鏅鸿兘杩囨护鍣?- 婵€杩涙€ц兘浼樺寲锛岃繃婊ゅ奖鍝嶆€ц兘鐨勫脊骞?                filter: (danmu: any) => {
  // 鍩虹楠岃瘉
  if (!danmu.text || !danmu.text.trim()) return false

  const text = danmu.text.trim();

  // 馃敟 婵€杩涢暱搴﹂檺鍒讹紝鍑忓皯DOM娓叉煋璐熸媴
  if (text.length > 50) return false // 浠?00鏀逛负50锛屾洿婵€杩?                  if (text.length < 2) return false  // 杩囩煭寮瑰箷閫氬父鏃犳剰涔?
  // 馃敟 婵€杩涚壒娈婂瓧绗﹁繃婊わ紝閬垮厤澶嶆潅娓叉煋
  const specialCharCount = (text.match(/[^\u4e00-\u9fa5a-zA-Z0-9\s.,!?锛涳紝銆傦紒锛焆/g) || []).length
                  if (specialCharCount > 5) return false // 浠?0鏀逛负5锛屾洿涓ユ牸

  // 馃敟 杩囨护绾暟瀛楁垨绾鍙峰脊骞曪紝鍑忓皯鏃犳剰涔夋覆鏌?                  if (/^\d+$/.test(text)) return false
  if (/^[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]+$/.test(text)) return false

  // 馃敟 杩囨护甯歌浣庤川閲忓脊骞曪紝鎻愬崌鏁翠綋璐ㄩ噺
  const lowQualityPatterns = [
    /^666+$/, /^濂?$/, /^鍝?$/, /^鍟?$/,
    /^[!锛?銆傦紵?]+$/, /^鐗?$/, /^寮?$/
  ];
  if (lowQualityPatterns.some(pattern => pattern.test(text))) return false

  return true
},

// 馃殌 浼樺寲鐨勫脊骞曟樉绀哄墠妫€鏌ワ紙鎹㈡簮鏃舵€ц兘浼樺寲锛?                beforeVisible: (danmu: any) => {
return new Promise<boolean>((resolve) => {
  // 鎹㈡簮鏈熼棿蹇€熸嫆缁濆脊骞曟樉绀猴紝鍑忓皯澶勭悊寮€閿€
  if (isSourceChangingRef.current) {
    resolve(false);
    return;
  }

  // 馃幆 鍔ㄦ€佸脊骞曞瘑搴︽帶鍒?- 鏍规嵁褰撳墠灞忓箷涓婄殑寮瑰箷鏁伴噺鍐冲畾鏄惁鏄剧ず
  const currentVisibleCount = document.querySelectorAll('.art-danmuku [data-state="emit"]').length;
  const maxConcurrentDanmu = devicePerformance === 'high' ? 60 :
    devicePerformance === 'medium' ? 40 : 25;

  if (currentVisibleCount >= maxConcurrentDanmu) {
    // 馃敟 褰撳脊骞曞瘑搴﹁繃楂樻椂锛岄殢鏈轰涪寮冮儴鍒嗗脊骞曪紝淇濇寔娴佺晠鎬?                      const dropRate = devicePerformance === 'high' ? 0.1 :
    devicePerformance === 'medium' ? 0.3 : 0.5;
    if (Math.random() < dropRate) {
      resolve(false); // 涓㈠純褰撳墠寮瑰箷
      return;
    }
  }

  // 馃幆 纭欢鍔犻€熶紭鍖?                    if (danmu.$ref && danmu.mode === 0) {
  danmu.$ref.style.willChange = 'transform';
  danmu.$ref.style.backfaceVisibility = 'hidden';

  // 浣庢€ц兘璁惧棰濆浼樺寲
  if (devicePerformance === 'low') {
    danmu.$ref.style.transform = 'translateZ(0)'; // 寮哄埗纭欢鍔犻€?                        danmu.$ref.classList.add('art-danmuku-optimized');
  }
}

                    resolve(true);
                  });
                },
              }

// 鏍规嵁璁惧鎬ц兘璋冩暣鏍稿績閰嶇疆
switch (devicePerformance) {
  case 'high': // 楂樻€ц兘璁惧 - 瀹屾暣鍔熻兘
    return {
      ...baseConfig,
      antiOverlap: true, // 寮€鍚槻閲嶅彔
      synchronousPlayback: true, // 淇濇寔寮瑰箷涓庤棰戞挱鏀鹃€熷害鍚屾
      useWorker: true, // v5.2.0: 鍚敤Web Worker浼樺寲
    }

  case 'medium': // 涓瓑鎬ц兘璁惧 - 閫傚害浼樺寲
    return {
      ...baseConfig,
      antiOverlap: !isMobile, // 绉诲姩绔叧闂槻閲嶅彔
      synchronousPlayback: true, // 淇濇寔鍚屾鎾斁浠ョ‘淇濅綋楠屼竴鑷?                    useWorker: true, // v5.2.0: 涓瓑璁惧涔熷惎鐢╓orker
    }

  case 'low': // 浣庢€ц兘璁惧 - 骞宠　浼樺寲
    return {
      ...baseConfig,
      antiOverlap: false, // 鍏抽棴澶嶆潅鐨勯槻閲嶅彔绠楁硶
      synchronousPlayback: true, // 淇濇寔鍚屾浠ョ‘淇濅綋楠岋紝璁＄畻閲忎笉澶?                    useWorker: true, // 寮€鍚疻orker鍑忓皯涓荤嚎绋嬭礋鎷?                    maxLength: 30, // v5.2.0浼樺寲: 鍑忓皯寮瑰箷鏁伴噺鏄叧閿紭鍖?                  }
    }
}

const config = getOptimizedConfig()

// 馃帹 涓轰綆鎬ц兘璁惧娣诲姞CSS纭欢鍔犻€熸牱寮?            if (devicePerformance === 'low') {
// 鍒涘缓CSS鍔ㄧ敾鏍峰紡锛堢‖浠跺姞閫燂級
if (!document.getElementById('danmaku-performance-css')) {
  const style = document.createElement('style')
  style.id = 'danmaku-performance-css'
  style.textContent = `
                  /* 馃殌 纭欢鍔犻€熺殑寮瑰箷浼樺寲 */
                  .art-danmuku-optimized {
                    will-change: transform !important;
                    backface-visibility: hidden !important;
                    transform: translateZ(0) !important;
                    transition: transform linear !important;
                  }
                `
  document.head.appendChild(style)
  console.log('馃帹 宸插姞杞紺SS纭欢鍔犻€熶紭鍖?)
              }
            }

return config
          }) ()),
// Chromecast 鎻掍欢鍔犺浇绛栫暐锛?          // 鍙湪 Chrome 娴忚鍣ㄤ腑鏄剧ず Chromecast锛堟帓闄?iOS Chrome锛?          // Safari 鍜?iOS锛氫笉鏄剧ず Chromecast锛堢敤鍘熺敓 AirPlay锛?          // 鍏朵粬娴忚鍣細涓嶆樉绀?Chromecast锛堜笉鏀寔 Cast API锛?          ...(isChrome && !isIOS ? [
artplayerPluginChromecast({
  title: videoTitle ? `${videoTitle}${currentEpisodeIndex >= 0 ? ` - 绗?{currentEpisodeIndex + 1}闆哷 : ''}` : undefined,
    poster: videoCover || undefined,
  onStateChange: (state) => {
    console.log('Chromecast state changed:', state);
  },
  onCastAvailable: (available) => {
    console.log('Chromecast available:', available);
  },
  onCastStart: () => {
    console.log('Chromecast started');
  },
  onCastEnd: () => {
    console.log('Chromecast ended');
  },
  onError: (error) => {
    console.error('Chromecast error:', error);
  }
})
          ] : []),
// 姣涚幓鐠冩晥鏋滄帶鍒舵爮鎻掍欢 - 鐜颁唬鍖栨偓娴璁?          // CSS宸蹭紭鍖栵細妗岄潰98%瀹藉害锛岀Щ鍔ㄧ100%锛屾寜閽彲鑷姩缂╁皬閫傚簲
artplayerPluginLiquidGlass()
        ],
      });

// 璁剧疆 Portal 瀹瑰櫒涓?ArtPlayer 鐨?$player 鍏冪礌锛堝叏灞忔椂鍙湁璇ュ厓绱犲彲瑙侊級
setPortalContainer(artPlayerRef.current.template.$player);

// 鐩戝惉鎾斁鍣ㄤ簨浠?      artPlayerRef.current.on('ready', async () => {
setError(null);
setPlayerReady(true); // 鏍囪鎾斁鍣ㄥ凡灏辩华锛屽惎鐢ㄨ褰卞鍚屾

// 浣跨敤ArtPlayer layers API娣诲姞鍒嗚鲸鐜囧窘绔狅紙甯︽笎鍙樺拰鍙戝厜鏁堟灉锛?        const video = artPlayerRef.current.video as HTMLVideoElement;

// 娣诲姞鍒嗚鲸鐜囧窘绔爈ayer
artPlayerRef.current.layers.add({
  name: 'resolution-badge',
  html: '<div class="resolution-badge"></div>',
  style: {
    position: 'absolute',
    bottom: '60px',
    left: '20px',
    padding: '5px 12px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '700',
    color: 'white',
    textShadow: '0 1px 3px rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(10px)',
    pointerEvents: 'none',
    opacity: '1',
    transition: 'opacity 0.3s ease',
    letterSpacing: '0.5px',
  },
});

// 馃幀 鍏ㄥ睆鏍囬/闆嗘暟灞?        const fsEpisodeName = detail?.episodes_titles?.[currentEpisodeIndex] || '';
const fsHasEpisodes = detail?.episodes && detail.episodes.length > 1;
artPlayerRef.current.layers.add({
  name: 'fullscreen-title',
  html: `
            <div class="fullscreen-title-container">
              <div class="fullscreen-title-content">
                <h1 class="fullscreen-title-text">${detail?.title || ''}</h1>
                ${fsHasEpisodes && fsEpisodeName
      ? `<span class="fullscreen-episode-text">${fsEpisodeName}</span>`
      : fsHasEpisodes
        ? `<span class="fullscreen-episode-text">绗?${currentEpisodeIndex + 1} 闆?/span>`
        : ''}
              </div>
            </div>
          `,
  style: {
    position: 'absolute',
    top: '0',
    left: '0',
    right: '0',
    height: '80px',
    display: 'none',
    pointerEvents: 'none',
    zIndex: '20',
  },
});

// 鑷姩闅愯棌寰界珷鐨勫畾鏃跺櫒
let badgeHideTimer: NodeJS.Timeout | null = null;

const showBadge = () => {
  const badge = artPlayerRef.current?.layers['resolution-badge'];
  if (badge) {
    badge.style.opacity = '1';

    // 娓呴櫎涔嬪墠鐨勫畾鏃跺櫒
    if (badgeHideTimer) {
      clearTimeout(badgeHideTimer);
    }

    // 3绉掑悗鑷姩闅愯棌寰界珷
    badgeHideTimer = setTimeout(() => {
      if (badge) {
        badge.style.opacity = '0';
      }
    }, 3000);
  }
};

const updateResolution = () => {
  if (video.videoWidth && video.videoHeight) {
    const width = video.videoWidth;
    const label = width >= 3840 ? '4K' :
      width >= 2560 ? '2K' :
        width >= 1920 ? '1080P' :
          width >= 1280 ? '720P' :
            width + 'P';

    // 鏍规嵁璐ㄩ噺璁剧疆涓嶅悓鐨勬笎鍙樿儗鏅拰鍙戝厜鏁堟灉
    let gradientStyle = '';
    let boxShadow = '';

    if (width >= 3840) {
      // 4K - 閲戣壊/绱壊娓愬彉 + 閲戣壊鍙戝厜
      gradientStyle = 'linear-gradient(135deg, #FFD700 0%, #FFA500 50%, #FF8C00 100%)';
      boxShadow = '0 0 20px rgba(255, 215, 0, 0.6), 0 0 10px rgba(255, 165, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
    } else if (width >= 2560) {
      // 2K - 钃濊壊/闈掕壊娓愬彉 + 钃濊壊鍙戝厜
      gradientStyle = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      boxShadow = '0 0 20px rgba(102, 126, 234, 0.6), 0 0 10px rgba(118, 75, 162, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
    } else if (width >= 1920) {
      // 1080P - 缁胯壊/闈掕壊娓愬彉 + 缁胯壊鍙戝厜
      gradientStyle = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
      boxShadow = '0 0 15px rgba(17, 153, 142, 0.5), 0 0 8px rgba(56, 239, 125, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
    } else if (width >= 1280) {
      // 720P - 姗欒壊娓愬彉 + 姗欒壊鍙戝厜
      gradientStyle = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
      boxShadow = '0 0 15px rgba(240, 147, 251, 0.4), 0 0 8px rgba(245, 87, 108, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.3)';
    } else {
      // 浣庤川閲?- 鐏拌壊娓愬彉
      gradientStyle = 'linear-gradient(135deg, #606c88 0%, #3f4c6b 100%)';
      boxShadow = '0 0 10px rgba(96, 108, 136, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)';
    }

    // 鏇存柊layer鍐呭鍜屾牱寮?            const badge = artPlayerRef.current.layers['resolution-badge'];
    if (badge) {
      badge.innerHTML = label;
      badge.style.background = gradientStyle;
      badge.style.boxShadow = boxShadow;
    }

    // 鍚屾椂鏇存柊state渚汻eact浣跨敤
    setVideoResolution({ width: video.videoWidth, height: video.videoHeight });

    // 鏄剧ず寰界珷骞跺惎鍔ㄨ嚜鍔ㄩ殣钘忓畾鏃跺櫒
    showBadge();
  }
};

// 鐩戝惉loadedmetadata浜嬩欢鑾峰彇鍒嗚鲸鐜?        video.addEventListener('loadedmetadata', updateResolution);
if (video.videoWidth && video.videoHeight) {
  updateResolution();
}

// 鐢ㄦ埛浜や簰鏃堕噸鏂版樉绀哄窘绔狅紙榧犳爣绉诲姩銆佺偣鍑汇€侀敭鐩樻搷浣滐級
const userInteractionEvents = ['mousemove', 'click', 'touchstart', 'keydown'];
userInteractionEvents.forEach(eventName => {
  artPlayerRef.current.on(eventName, showBadge);
});

// 瑙傚奖瀹ゆ椂闂村悓姝ワ細浠嶶RL鍙傛暟璇诲彇鍒濆鎾斁鏃堕棿
const timeParam = searchParams.get('t') || searchParams.get('time');
if (timeParam && artPlayerRef.current) {
  const seekTime = parseFloat(timeParam);
  if (!isNaN(seekTime) && seekTime > 0) {
    console.log('[WatchRoom] Seeking to synced time:', seekTime);
    setTimeout(() => {
      if (artPlayerRef.current) {
        artPlayerRef.current.currentTime = seekTime;
      }
    }, 500); // 寤惰繜纭繚鎾斁鍣ㄥ畬鍏ㄥ氨缁?          }
  }

  // iOS璁惧鑷姩鎾斁浼樺寲锛氬鏋滄槸闈欓煶鍚姩鐨勶紝鍦ㄥ紑濮嬫挱鏀惧悗鎭㈠闊抽噺
  if ((isIOS || isSafari) && artPlayerRef.current.muted) {
    console.log('iOS璁惧闈欓煶鑷姩鎾斁锛屽噯澶囧湪鎾斁寮€濮嬪悗鎭㈠闊抽噺');

    const handleFirstPlay = () => {
      setTimeout(() => {
        if (artPlayerRef.current && artPlayerRef.current.muted) {
          artPlayerRef.current.muted = false;
          artPlayerRef.current.volume = lastVolumeRef.current || 0.7;
          console.log('iOS璁惧宸叉仮澶嶉煶閲?', artPlayerRef.current.volume);
        }
      }, 500); // 寤惰繜500ms纭繚鎾斁绋冲畾

      // 鍙墽琛屼竴娆?            artPlayerRef.current.off('video:play', handleFirstPlay);
    };

    artPlayerRef.current.on('video:play', handleFirstPlay);
  }

  // 娣诲姞寮瑰箷鎻掍欢鎸夐挳閫夋嫨鎬ч殣钘廋SS
  const optimizeDanmukuControlsCSS = () => {
    if (document.getElementById('danmuku-controls-optimize')) return;

    const style = document.createElement('style');
    style.id = 'danmuku-controls-optimize';
    style.textContent = `
            /* 闅愯棌寮瑰箷寮€鍏虫寜閽拰鍙戝皠鍣?*/
            .artplayer-plugin-danmuku .apd-toggle {
              display: none !important;
            }

            .artplayer-plugin-danmuku .apd-emitter {
              display: none !important;
            }

            
            /* 寮瑰箷閰嶇疆闈㈡澘浼樺寲 - 淇鍏ㄥ睆妯″紡涓嬬偣鍑婚棶棰?*/
            .artplayer-plugin-danmuku .apd-config {
              position: relative;
            }
            
            .artplayer-plugin-danmuku .apd-config-panel {
              /* 浣跨敤缁濆瀹氫綅鑰屼笉鏄痜ixed锛岃ArtPlayer鐨勫姩鎬佸畾浣嶇敓鏁?*/
              position: absolute !important;
              /* 淇濇寔ArtPlayer鍘熺増鐨勯粯璁eft: 0锛岃JS鍔ㄦ€佽鐩?*/
              /* 淇濈暀z-index纭繚灞傜骇姝ｇ‘ */
              z-index: 2147483647 !important; /* 浣跨敤鏈€澶-index纭繚鍦ㄥ叏灞忔ā寮忎笅涔熻兘鏄剧ず鍦ㄦ渶椤跺眰 */
              /* 纭繚闈㈡澘鍙互鎺ユ敹鐐瑰嚮浜嬩欢 */
              pointer-events: auto !important;
              /* 娣诲姞涓€浜涘熀纭€鏍峰紡纭繚鍙鎬?*/
              background: rgba(0, 0, 0, 0.8);
              border-radius: 6px;
              backdrop-filter: blur(10px);
            }
            
            /* 鍏ㄥ睆妯″紡涓嬬殑鐗规畩浼樺寲 */
            .artplayer[data-fullscreen="true"] .artplayer-plugin-danmuku .apd-config-panel {
              /* 鍏ㄥ睆鏃朵娇鐢ㄥ浐瀹氬畾浣嶅苟璋冩暣浣嶇疆 */
              position: fixed !important;
              top: auto !important;
              bottom: 80px !important; /* 璺濈搴曢儴鎺у埗鏍?0px */
              right: 20px !important; /* 璺濈鍙宠竟20px */
              left: auto !important;
              z-index: 2147483647 !important;
            }
            
            /* 纭繚鍏ㄥ睆妯″紡涓嬪脊骞曢潰鏉垮唴閮ㄥ厓绱犲彲鐐瑰嚮 */
            .artplayer[data-fullscreen="true"] .artplayer-plugin-danmuku .apd-config-panel * {
              pointer-events: auto !important;
            }
          `;
    document.head.appendChild(style);
  };

  // 搴旂敤CSS浼樺寲
  optimizeDanmukuControlsCSS();

  // 绮剧‘瑙ｅ喅寮瑰箷鑿滃崟涓庤繘搴︽潯鎷栨嫿鍐茬獊 - 鍩轰簬ArtPlayer鍘熺敓鎷栨嫿閫昏緫
  const fixDanmakuProgressConflict = () => {
    let isDraggingProgress = false;

    setTimeout(() => {
      const progressControl = document.querySelector('.art-control-progress') as HTMLElement;
      if (!progressControl) return;

      // 娣诲姞绮剧‘鐨凜SS鎺у埗
      const addPrecisionCSS = () => {
        if (document.getElementById('danmaku-drag-fix')) return;

        const style = document.createElement('style');
        style.id = 'danmaku-drag-fix';
        style.textContent = `
                /* 馃敡 淇闀挎椂闂存挱鏀惧悗寮瑰箷鑿滃崟hover澶辨晥闂 */

                /* 纭繚鎺у埗鍏冪礌鏈韩鍙互鎺ユ敹榧犳爣浜嬩欢锛屾仮澶嶅師鐢焗over鏈哄埗 */
                .artplayer-plugin-danmuku .apd-config,
                .artplayer-plugin-danmuku .apd-style {
                  pointer-events: auto !important;
                }

                /* 绠€鍖栵細渚濊禆鍏ㄥ眬CSS涓殑hover澶勭悊 */

                /* 纭繚杩涘害鏉″眰绾ц冻澶熼珮锛岄伩鍏嶈寮瑰箷闈㈡澘閬尅 */
                .art-progress {
                  position: relative;
                  z-index: 1000 !important;
                }

                /* 闈㈡澘鑳屾櫙鍦ㄩ潪hover鐘舵€佷笅涓嶆嫤鎴簨浠讹紝浣嗗厑璁竓over妫€娴?*/
                .artplayer-plugin-danmuku .apd-config-panel:not(:hover),
                .artplayer-plugin-danmuku .apd-style-panel:not(:hover) {
                  pointer-events: none;
                }

                /* 闈㈡澘鍐呯殑鍏蜂綋鎺т欢濮嬬粓鍙互浜や簰 */
                .artplayer-plugin-danmuku .apd-config-panel-inner,
                .artplayer-plugin-danmuku .apd-style-panel-inner,
                .artplayer-plugin-danmuku .apd-config-panel .apd-mode,
                .artplayer-plugin-danmuku .apd-config-panel .apd-other,
                .artplayer-plugin-danmuku .apd-config-panel .apd-slider,
                .artplayer-plugin-danmuku .apd-style-panel .apd-mode,
                .artplayer-plugin-danmuku .apd-style-panel .apd-color {
                  pointer-events: auto !important;
                }
              `;
        document.head.appendChild(style);
      };

      // 绮剧‘妯℃嫙ArtPlayer鐨勬嫋鎷芥娴嬮€昏緫
      const handleProgressMouseDown = (event: MouseEvent) => {
        // 鍙湁宸﹂敭鎵嶅紑濮嬫嫋鎷芥娴?              if (event.button === 0) {
        isDraggingProgress = true;
        const artplayer = document.querySelector('.artplayer') as HTMLElement;
        if (artplayer) {
          artplayer.setAttribute('data-dragging', 'true');
        }
      }
    };

    // 鐩戝惉document鐨刴ousemove锛屼笌ArtPlayer淇濇寔涓€鑷?            const handleDocumentMouseMove = () => {
    // 濡傛灉姝ｅ湪鎷栨嫿锛岀‘淇濆脊骞曡彍鍗曡闅愯棌
    if (isDraggingProgress) {
      const panels = document.querySelectorAll('.artplayer-plugin-danmuku .apd-config-panel, .artplayer-plugin-danmuku .apd-style-panel') as NodeListOf<HTMLElement>;
      panels.forEach(panel => {
        if (panel.style.opacity !== '0') {
          panel.style.opacity = '0';
          panel.style.pointerEvents = 'none';
        }
      });
    }
  };

  // mouseup鏃剁珛鍗虫仮澶?- 涓嶢rtPlayer閫昏緫瀹屽叏鍚屾
  const handleDocumentMouseUp = () => {
    if (isDraggingProgress) {
      isDraggingProgress = false;
      const artplayer = document.querySelector('.artplayer') as HTMLElement;
      if (artplayer) {
        artplayer.removeAttribute('data-dragging');
      }
      // 绔嬪嵆鎭㈠锛屼笉浣跨敤寤惰繜
    }
  };

  // 缁戝畾浜嬩欢 - 涓嶢rtPlayer浣跨敤鐩稿悓鐨勪簨浠剁粦瀹氭柟寮?            progressControl.addEventListener('mousedown', handleProgressMouseDown);
  document.addEventListener('mousemove', handleDocumentMouseMove);
  document.addEventListener('mouseup', handleDocumentMouseUp);

  // 搴旂敤CSS
  addPrecisionCSS();

  // 馃攧 娣诲姞瀹氭湡閲嶇疆鏈哄埗锛岄槻姝㈤暱鏃堕棿鎾斁鍚庣姸鎬佹薄鏌?            const danmakuResetInterval = setInterval(() => {
    clearInterval(danmakuResetInterval);
    return;
  }

  try {
    // 閲嶇疆寮瑰箷鎺т欢鍜岄潰鏉跨姸鎬?                const controls = document.querySelectorAll('.artplayer-plugin-danmuku .apd-config, .artplayer-plugin-danmuku .apd-style') as NodeListOf<HTMLElement>;
    const panels = document.querySelectorAll('.artplayer-plugin-danmuku .apd-config-panel, .artplayer-plugin-danmuku .apd-style-panel') as NodeListOf<HTMLElement>;

    // 寮哄埗閲嶇疆鎺у埗鍏冪礌鐨勪簨浠舵帴鏀惰兘鍔?                controls.forEach(control => {
    if (control.style.pointerEvents === 'none') {
      control.style.pointerEvents = 'auto';
    }
  });

  // 閲嶇疆闈㈡澘鐘舵€侊紝浣嗕笉褰卞搷褰撳墠hover鐘舵€?                panels.forEach(panel => {
  if (!panel.matches(':hover') && panel.style.opacity === '0') {
    panel.style.opacity = '';
    panel.style.pointerEvents = '';
    panel.style.visibility = '';
  }
});

console.log('馃攧 寮瑰箷鑿滃崟hover鐘舵€佸凡閲嶇疆');
              } catch (error) {
  console.warn('寮瑰箷鐘舵€侀噸缃け璐?', error);
}
            }, 300000); // 姣?鍒嗛挓閲嶇疆涓€娆?
// 馃殌 绔嬪嵆鎭㈠hover鐘舵€侊紙淇褰撳墠鍙兘宸插瓨鍦ㄧ殑闂锛?            const immediateRestore = () => {
const controls = document.querySelectorAll('.artplayer-plugin-danmuku .apd-config, .artplayer-plugin-danmuku .apd-style') as NodeListOf<HTMLElement>;
controls.forEach(control => {
  control.style.pointerEvents = 'auto';
});
console.log('馃殌 寮瑰箷鑿滃崟hover鐘舵€佸凡绔嬪嵆鎭㈠');
            };

            // 绔嬪嵆鎵ц涓€娆℃仮澶?            setTimeout(immediateRestore, 100);

          }, 1500); // 绛夊緟寮瑰箷鎻掍欢鍔犺浇
        };

// 鍚敤绮剧‘淇
fixDanmakuProgressConflict();

// 绉诲姩绔脊骞曢厤缃寜閽偣鍑诲垏鎹㈡敮鎸?- 鍩轰簬ArtPlayer璁剧疆鎸夐挳鍘熺悊
const addMobileDanmakuToggle = () => {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

  setTimeout(() => {
    const configButton = document.querySelector('.artplayer-plugin-danmuku .apd-config');
    const configPanel = document.querySelector('.artplayer-plugin-danmuku .apd-config-panel');

    if (!configButton || !configPanel) {
      console.warn('寮瑰箷閰嶇疆鎸夐挳鎴栭潰鏉挎湭鎵惧埌');
      return;
    }

    console.log('璁惧绫诲瀷:', isMobile ? '绉诲姩绔? : '妗岄潰绔 ?);

    // 妗岄潰绔細绠€鍖栧鐞嗭紝渚濊禆CSS hover锛岀Щ闄ゅ鏉傜殑JavaScript浜嬩欢
    if (!isMobile) {
      console.log('妗岄潰绔細浣跨敤CSS鍘熺敓hover锛岄伩鍏岼avaScript浜嬩欢鍐茬獊');
      return;
    }

    if (isMobile) {
      // 绉诲姩绔細娣诲姞鐐瑰嚮鍒囨崲鏀寔 + 鎸佷箙浣嶇疆淇
      console.log('涓虹Щ鍔ㄧ娣诲姞寮瑰箷閰嶇疆鎸夐挳鐐瑰嚮鍒囨崲鍔熻兘');

      let isConfigVisible = false;

      // 寮瑰箷闈㈡澘浣嶇疆淇鍑芥暟 - 绠€鍖栫増鏈?              const adjustPanelPosition = () => {
      const player = document.querySelector('.artplayer');
      if (!player || !configButton || !configPanel) return;

      try {
        const panelElement = configPanel as HTMLElement;

        // 濮嬬粓娓呴櫎鍐呰仈鏍峰紡锛屼娇鐢–SS榛樿瀹氫綅
        panelElement.style.left = '';
        panelElement.style.right = '';
        panelElement.style.transform = '';

        console.log('寮瑰箷闈㈡澘锛氫娇鐢–SS榛樿瀹氫綅锛岃嚜鍔ㄩ€傞厤灞忓箷鏂瑰悜');
      } catch (error) {
        console.warn('寮瑰箷闈㈡澘浣嶇疆璋冩暣澶辫触:', error);
      }
    };

    // 娣诲姞鐐瑰嚮浜嬩欢鐩戝惉鍣?              configButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    isConfigVisible = !isConfigVisible;

    if (isConfigVisible) {
      (configPanel as HTMLElement).style.display = 'block';
      // 鏄剧ず鍚庣珛鍗宠皟鏁翠綅缃?                  setTimeout(adjustPanelPosition, 10);
      console.log('绉诲姩绔脊骞曢厤缃潰鏉匡細鏄剧ず');
    } else {
      (configPanel as HTMLElement).style.display = 'none';
      console.log('绉诲姩绔脊骞曢厤缃潰鏉匡細闅愯棌');
    }
  });

  // 鐩戝惉ArtPlayer鐨剅esize浜嬩欢
  if (artPlayerRef.current) {
    artPlayerRef.current.on('resize', () => {
      if (isConfigVisible) {
        console.log('妫€娴嬪埌ArtPlayer resize浜嬩欢锛岄噸鏂拌皟鏁村脊骞曢潰鏉夸綅缃?);
                    setTimeout(adjustPanelPosition, 50); // 鐭殏寤惰繜纭繚resize瀹屾垚
      }
    });
    console.log('宸茬洃鍚珹rtPlayer resize浜嬩欢锛屽疄鐜拌嚜鍔ㄩ€傞厤');
  }

  // 棰濆鐩戝惉灞忓箷鏂瑰悜鍙樺寲浜嬩欢锛岀‘淇濆畬鍏ㄨ嚜鍔ㄩ€傞厤
  const handleOrientationChange = () => {
    if (isConfigVisible) {
      console.log('妫€娴嬪埌灞忓箷鏂瑰悜鍙樺寲锛岄噸鏂拌皟鏁村脊骞曢潰鏉夸綅缃?);
                  setTimeout(adjustPanelPosition, 100); // 绋嶉暱寤惰繜绛夊緟鏂瑰悜鍙樺寲瀹屾垚
    }
  };

  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('resize', handleOrientationChange);

  // 娓呯悊鍑芥暟
  const _cleanup = () => {
    window.removeEventListener('orientationchange', handleOrientationChange);
    window.removeEventListener('resize', handleOrientationChange);
  };

  // 鐐瑰嚮鍏朵粬鍦版柟鑷姩闅愯棌
  document.addEventListener('click', (e) => {
    if (isConfigVisible &&
      !configButton.contains(e.target as Node) &&
      !configPanel.contains(e.target as Node)) {
      isConfigVisible = false;
      (configPanel as HTMLElement).style.display = 'none';
      console.log('鐐瑰嚮澶栭儴鍖哄煙锛岄殣钘忓脊骞曢厤缃潰鏉?);
                }
  });

  console.log('绉诲姩绔脊骞曢厤缃垏鎹㈠姛鑳藉凡婵€娲?);
            }
          }, 2000); // 寤惰繜2绉掔‘淇濆脊骞曟彃浠跺畬鍏ㄥ垵濮嬪寲
        };

// 鍚敤绉诲姩绔脊骞曢厤缃垏鎹?        addMobileDanmakuToggle();

// 鎾斁鍣ㄥ氨缁悗锛屽姞杞藉閮ㄥ脊骞曟暟鎹?        console.log('鎾斁鍣ㄥ凡灏辩华锛屽紑濮嬪姞杞藉閮ㄥ脊骞?);
setTimeout(async () => {
  try {
    console.log('澶栭儴寮瑰箷鍔犺浇缁撴灉:', result.count, '鏉?);

      danmuPlugin.load(); // 娓呯┖宸叉湁寮瑰箷
      if (result.count > 0) {
        console.log('鍚戞挱鏀惧櫒鎻掍欢鍔犺浇寮瑰箷鏁版嵁:', result.count, '鏉?);
                danmuPlugin.load(result.data);
        artPlayerRef.current.notice.show = `宸插姞杞?${result.count} 鏉″脊骞昤;
              } else {
                console.log('娌℃湁寮瑰箷鏁版嵁鍙姞杞?);
                artPlayerRef.current.notice.show = '鏆傛棤寮瑰箷鏁版嵁';
              }
            } else {
              console.error('寮瑰箷鎻掍欢鏈壘鍒?);
            }
          } catch (error) {
            console.error('鍔犺浇澶栭儴寮瑰箷澶辫触:', error);
          }
        }, 1000); // 寤惰繜1绉掔‘淇濇彃浠跺畬鍏ㄥ垵濮嬪寲

        // 鐩戝惉寮瑰箷鎻掍欢鐨勬樉绀?闅愯棌浜嬩欢锛岃嚜鍔ㄤ繚瀛樼姸鎬佸埌localStorage
          localStorage.setItem('danmaku_visible', 'true');
          console.log('寮瑰箷鏄剧ず鐘舵€佸凡淇濆瓨');
        });

          localStorage.setItem('danmaku_visible', 'false');
          console.log('寮瑰箷闅愯棌鐘舵€佸凡淇濆瓨');
        });

        // 鐩戝惉寮瑰箷鎻掍欢鐨勯厤缃彉鏇翠簨浠讹紝鑷姩淇濆瓨鎵€鏈夎缃埌localStorage
          try {
            // 淇濆瓨鎵€鏈夊脊骞曢厤缃埌localStorage
            if (typeof option.fontSize !== 'undefined') {
              localStorage.setItem('danmaku_fontSize', option.fontSize.toString());
            }
            if (typeof option.opacity !== 'undefined') {
              localStorage.setItem('danmaku_opacity', option.opacity.toString());
            }
            if (typeof option.speed !== 'undefined') {
              localStorage.setItem('danmaku_speed', option.speed.toString());
            }
            if (typeof option.margin !== 'undefined') {
              localStorage.setItem('danmaku_margin', JSON.stringify(option.margin));
            }
            if (typeof option.modes !== 'undefined') {
              localStorage.setItem('danmaku_modes', JSON.stringify(option.modes));
            }
            if (typeof option.antiOverlap !== 'undefined') {
              localStorage.setItem('danmaku_antiOverlap', option.antiOverlap.toString());
            }
            if (typeof option.visible !== 'undefined') {
              localStorage.setItem('danmaku_visible', option.visible.toString());
            }
            console.log('寮瑰箷閰嶇疆宸茶嚜鍔ㄤ繚瀛?', option);
          } catch (error) {
            console.error('淇濆瓨寮瑰箷閰嶇疆澶辫触:', error);
          }
        });

        // 鐩戝惉鎾斁杩涘害璺宠浆锛屼紭鍖栧脊骞曢噸缃紙鍑忓皯闂儊锛?        artPlayerRef.current.on('seek', () => {
            // 娓呴櫎涔嬪墠鐨勯噸缃鏃跺櫒
            if (seekResetTimeoutRef.current) {
              clearTimeout(seekResetTimeoutRef.current);
            }
            
            // 澧炲姞寤惰繜骞跺彧鍦ㄩ潪鎷栨嫿鐘舵€佷笅閲嶇疆锛屽噺灏戝揩杩涙椂鐨勯棯鐑?            seekResetTimeoutRef.current = setTimeout(() => {
                console.log('杩涘害璺宠浆锛屽脊骞曞凡閲嶇疆');
              }
            }, 500); // 澧炲姞鍒?00ms寤惰繜锛屽噺灏戦绻侀噸缃鑷寸殑闂儊
          }
        });

        // 鐩戝惉鎷栨嫿鐘舵€?- v5.2.0浼樺寲: 鍦ㄦ嫋鎷芥湡闂存殏鍋滃脊骞曟洿鏂颁互鍑忓皯闂儊
        artPlayerRef.current.on('video:seeking', () => {
          isDraggingProgressRef.current = true;
          // v5.2.0鏂板: 鎷栨嫿鏃堕殣钘忓脊骞曪紝鍑忓皯CPU鍗犵敤鍜岄棯鐑?          // 鍙湁鍦ㄥ閮ㄥ脊骞曞紑鍚笖褰撳墠鏄剧ず鏃舵墠闅愯棌
          }
        });

        artPlayerRef.current.on('video:seeked', () => {
          isDraggingProgressRef.current = false;
                  console.log('鎷栨嫿缁撴潫锛屽脊骞曞凡閲嶇疆');
                }
              }, 100);
            } else {
              console.log('鎷栨嫿缁撴潫锛屽閮ㄥ脊骞曞凡鍏抽棴锛屼繚鎸侀殣钘忕姸鎬?);
            }
          }
        });

        // 鐩戝惉鎾斁鍣ㄧ獥鍙ｅ昂瀵稿彉鍖栵紝瑙﹀彂寮瑰箷閲嶇疆锛堝弻閲嶄繚闅滐級
        artPlayerRef.current.on('resize', () => {
          // 娓呴櫎涔嬪墠鐨勯噸缃鏃跺櫒
          if (resizeResetTimeoutRef.current) {
            clearTimeout(resizeResetTimeoutRef.current);
          }
          
          // 寤惰繜閲嶇疆寮瑰箷锛岄伩鍏嶈繛缁Е鍙戯紙鍏ㄥ睆鍒囨崲浼樺寲锛?          resizeResetTimeoutRef.current = setTimeout(() => {
              console.log('绐楀彛灏哄鍙樺寲锛屽脊骞曞凡閲嶇疆锛堥槻鎶栦紭鍖栵級');
            }
          }, 300); // 300ms闃叉姈锛屽噺灏戝叏灞忓垏鎹㈡椂鐨勫崱椤?        });

        // 鎾斁鍣ㄥ氨缁悗锛屽鏋滄鍦ㄦ挱鏀惧垯璇锋眰 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      // 鐩戝惉鎾斁鐘舵€佸彉鍖栵紝鎺у埗 Wake Lock
      artPlayerRef.current.on('play', () => {
        requestWakeLock();
      });

      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        // 馃敟 鍏抽敭淇锛氭殏鍋滄椂涔熸鏌ユ槸鍚﹀湪鐗囧熬锛岄伩鍏嶄繚瀛橀敊璇殑杩涘害
        const currentTime = artPlayerRef.current?.currentTime || 0;
        const duration = artPlayerRef.current?.duration || 0;
        const remainingTime = duration - currentTime;
        const isNearEnd = duration > 0 && remainingTime < 180; // 鏈€鍚?鍒嗛挓

        if (!isNearEnd) {
          saveCurrentPlayProgress();
        }
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
      });

      // 濡傛灉鎾斁鍣ㄥ垵濮嬪寲鏃跺凡缁忓湪鎾斁鐘舵€侊紝鍒欒姹?Wake Lock
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 鐩戝惉鍏ㄥ睆浜嬩欢锛岃繘鍏ュ叏灞忓悗鑷姩闅愯棌鎺у埗鏍?+ 鏄剧ず鏍囬灞?      artPlayerRef.current.on('fullscreen', (isFullscreen: boolean) => {
        const titleLayer = artPlayerRef.current?.layers['fullscreen-title'];
        if (titleLayer) {
          titleLayer.style.display = isFullscreen ? 'block' : 'none';
        }
        if (isFullscreen) {
          // 杩涘叆鍏ㄥ睆鍚庯紝寤惰繜100ms瑙﹀彂鎺у埗鏍忚嚜鍔ㄩ殣钘?          setTimeout(() => {
            if (artPlayerRef.current?.controls) {
              artPlayerRef.current.controls.show = true;
            }
          }, 100);
        }
      });

      // 鐩戝惉缃戦〉鍏ㄥ睆浜嬩欢锛屾樉绀?闅愯棌鏍囬灞?      artPlayerRef.current.on('fullscreenWeb', (isFullscreenWeb: boolean) => {
        const titleLayer = artPlayerRef.current?.layers['fullscreen-title'];
        if (titleLayer) {
          titleLayer.style.display = isFullscreenWeb ? 'block' : 'none';
        }
      });

      // 鐩戝惉瑙嗛鍙挱鏀句簨浠讹紝杩欐椂鎭㈠鎾斁杩涘害鏇村彲闈?      artPlayerRef.current.on('video:canplay', () => {
        // 馃敟 閲嶇疆 video:ended 澶勭悊鏍囧織锛屽洜涓鸿繖鏄柊瑙嗛
        videoEndedHandledRef.current = false;

        // 鑻ュ瓨鍦ㄩ渶瑕佹仮澶嶇殑鎾斁杩涘害锛屽垯璺宠浆
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('鎴愬姛鎭㈠鎾斁杩涘害鍒?', resumeTimeRef.current);
          } catch (err) {
            console.warn('鎭㈠鎾斁杩涘害澶辫触:', err);
          }
        }
        resumeTimeRef.current = null;

        // iOS璁惧鑷姩鎾斁鍥為€€鏈哄埗锛氬鏋滆嚜鍔ㄦ挱鏀惧け璐ワ紝灏濊瘯鐢ㄦ埛浜や簰瑙﹀彂鎾斁
        if ((isIOS || isSafari) && artPlayerRef.current.paused) {
          console.log('iOS璁惧妫€娴嬪埌瑙嗛鏈嚜鍔ㄦ挱鏀撅紝鍑嗗浜や簰瑙﹀彂鏈哄埗');
          
          const tryAutoPlay = async () => {
            try {
              // 澶氶噸灏濊瘯绛栫暐
              let playAttempts = 0;
              const maxAttempts = 3;
              
              const attemptPlay = async (): Promise<boolean> => {
                playAttempts++;
                console.log(`iOS鑷姩鎾斁灏濊瘯 ${ playAttempts }/${maxAttempts}`);

try {
  await artPlayerRef.current.play();
  console.log('iOS璁惧鑷姩鎾斁鎴愬姛');
  return true;
} catch (playError: any) {
  console.log(`鎾斁灏濊瘯 ${playAttempts} 澶辫触:`, playError.name);

  // 鏍规嵁閿欒绫诲瀷閲囩敤涓嶅悓绛栫暐
  if (playError.name === 'NotAllowedError') {
    // 鐢ㄦ埛浜や簰闇€姹傞敊璇?- 鏈€甯歌
    if (playAttempts < maxAttempts) {
      // 灏濊瘯闄嶄綆闊抽噺鍐嶆挱鏀?                      artPlayerRef.current.volume = 0.1;
      await new Promise(resolve => setTimeout(resolve, 200));
      return attemptPlay();
    }
    return false;
  } else if (playError.name === 'AbortError') {
    // 鎾斁琚腑鏂?- 绛夊緟鍚庨噸璇?                    if (playAttempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return attemptPlay();
  }
  return false;
}
return false;
                }
              };

const success = await attemptPlay();

if (!success) {
  console.log('iOS璁惧闇€瑕佺敤鎴蜂氦浜掓墠鑳芥挱鏀撅紝杩欐槸姝ｅ父鐨勬祻瑙堝櫒琛屼负');
  // 鏄剧ず鍙嬪ソ鐨勬挱鏀炬彁绀?                if (artPlayerRef.current) {
  artPlayerRef.current.notice.show = '杞昏Е鎾斁鎸夐挳寮€濮嬭鐪?;

  // 娣诲姞涓€娆℃€х偣鍑荤洃鍚櫒鐢ㄤ簬棣栨鎾斁
  let hasHandledFirstInteraction = false;
  const handleFirstUserInteraction = async () => {
    if (hasHandledFirstInteraction) return;
    hasHandledFirstInteraction = true;

    try {
      await artPlayerRef.current.play();
      // 棣栨鎴愬姛鎾斁鍚庢仮澶嶆甯搁煶閲?                      setTimeout(() => {
      if (artPlayerRef.current && !artPlayerRef.current.muted) {
        artPlayerRef.current.volume = lastVolumeRef.current || 0.7;
      }
    }, 1000);
  } catch (error) {
    console.warn('鐢ㄦ埛浜や簰鎾斁澶辫触:', error);
  }

  // 绉婚櫎鐩戝惉鍣?                    artPlayerRef.current?.off('video:play', handleFirstUserInteraction);
  document.removeEventListener('click', handleFirstUserInteraction);
};

// 鐩戝惉鎾斁浜嬩欢鍜岀偣鍑讳簨浠?                  artPlayerRef.current.on('video:play', handleFirstUserInteraction);
document.addEventListener('click', handleFirstUserInteraction);
                }
              }
            } catch (error) {
  console.warn('鑷姩鎾斁鍥為€€鏈哄埗鎵ц澶辫触:', error);
}
          };

// 寤惰繜灏濊瘯锛岄伩鍏嶄笌杩涘害鎭㈠鍐茬獊
setTimeout(tryAutoPlay, 200);
        }

setTimeout(() => {
  if (
    Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
  ) {
    artPlayerRef.current.volume = lastVolumeRef.current;
  }
  if (
    Math.abs(
      artPlayerRef.current.playbackRate - lastPlaybackRateRef.current
    ) > 0.01 &&
    isWebKit
  ) {
    artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
  }
  artPlayerRef.current.notice.show = '';
}, 0);

// 闅愯棌鎹㈡簮鍔犺浇鐘舵€?        setIsVideoLoading(false);

// 馃敟 閲嶇疆闆嗘暟鍒囨崲鏍囪瘑锛堟挱鏀惧櫒鎴愬姛鍒涘缓鍚庯級
if (isEpisodeChangingRef.current) {
  isEpisodeChangingRef.current = false;
  console.log('馃幆 鎾斁鍣ㄥ垱寤哄畬鎴愶紝閲嶇疆闆嗘暟鍒囨崲鏍囪瘑');
}
      });

// 鐩戝惉鎾斁鍣ㄩ敊璇?      artPlayerRef.current.on('error', (err: any) => {
console.error('鎾斁鍣ㄩ敊璇?', err);
if (artPlayerRef.current.currentTime > 0) {
  return;
}
      });

// 鐩戝惉瑙嗛鎾斁缁撴潫浜嬩欢锛岃嚜鍔ㄦ挱鏀句笅涓€闆?      artPlayerRef.current.on('video:ended', () => {
const idx = currentEpisodeIndexRef.current;

// 馃敟 鍏抽敭淇锛氶鍏堟鏌ヨ繖涓?video:ended 浜嬩欢鏄惁宸茬粡琚鐞嗚繃
if (videoEndedHandledRef.current) {
  return;
}

// 馃攽 妫€鏌ユ槸鍚﹀凡缁忛€氳繃 SkipController 瑙﹀彂浜嗕笅涓€闆嗭紝閬垮厤閲嶅瑙﹀彂
if (isSkipControllerTriggeredRef.current) {
  videoEndedHandledRef.current = true;
  // 馃敟 鍏抽敭淇锛氬欢杩熼噸缃爣蹇楋紝绛夊緟鏂伴泦鏁板紑濮嬪姞杞?          setTimeout(() => {
  isSkipControllerTriggeredRef.current = false;
}, 2000);
return;
        }

const d = detailRef.current;
if (d && d.episodes && idx < d.episodes.length - 1) {
  videoEndedHandledRef.current = true;
  setTimeout(() => {
    setCurrentEpisodeIndex(idx + 1);
  }, 1000);
}
      });

// 鍚堝苟鐨則imeupdate鐩戝惉鍣?- 澶勭悊璺宠繃鐗囧ご鐗囧熬鍜屼繚瀛樿繘搴?      artPlayerRef.current.on('video:timeupdate', () => {
const currentTime = artPlayerRef.current.currentTime || 0;
const duration = artPlayerRef.current.duration || 0;
const now = performance.now(); // 浣跨敤performance.now()鏇寸簿纭?
// 鏇存柊 SkipController 鎵€闇€鐨勬椂闂翠俊鎭?        setCurrentPlayTime(currentTime);
setVideoDuration(duration);

// 淇濆瓨鎾斁杩涘害閫昏緫 - 浼樺寲淇濆瓨闂撮殧浠ュ噺灏戠綉缁滃紑閿€
const saveNow = Date.now();
// 馃敡 浼樺寲锛氬鍔犳挱鏀句腑鐨勪繚瀛橀棿闅旓紝渚濊禆鏆傚仠鏃朵繚瀛樹綔涓轰富瑕佷繚瀛樻椂鏈?        // upstash: 60绉掑厹搴曚繚瀛橈紝鍏朵粬瀛樺偍: 30绉掑厹搴曚繚瀛?        // 鐢ㄦ埛鏆傚仠銆佸垏鎹㈤泦鏁般€侀〉闈㈠嵏杞芥椂浼氱珛鍗充繚瀛橈紝鍥犳杈冮暱闂撮殧涓嶅奖鍝嶄綋楠?        const interval = process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash' ? 60000 : 30000;

// 馃敟 鍏抽敭淇锛氬鏋滃綋鍓嶆挱鏀句綅缃帴杩戣棰戠粨灏撅紙鏈€鍚?鍒嗛挓锛夛紝涓嶄繚瀛樿繘搴?        // 杩欐槸涓轰簡閬垮厤鑷姩璺宠繃鐗囧熬鏃朵繚瀛樹簡鐗囧熬浣嶇疆鐨勮繘搴︼紝瀵艰嚧"缁х画瑙傜湅"浠庨敊璇綅缃紑濮?        const remainingTime = duration - currentTime;
const isNearEnd = duration > 0 && remainingTime < 180; // 鏈€鍚?鍒嗛挓

if (saveNow - lastSaveTimeRef.current > interval && !isNearEnd) {
  saveCurrentPlayProgress();
  lastSaveTimeRef.current = saveNow;
}
      });

artPlayerRef.current.on('pause', () => {
  // 馃敟 鍏抽敭淇锛氭殏鍋滄椂涔熸鏌ユ槸鍚﹀湪鐗囧熬锛岄伩鍏嶄繚瀛橀敊璇殑杩涘害
  const currentTime = artPlayerRef.current?.currentTime || 0;
  const duration = artPlayerRef.current?.duration || 0;
  const remainingTime = duration - currentTime;
  const isNearEnd = duration > 0 && remainingTime < 180; // 鏈€鍚?鍒嗛挓

  if (!isNearEnd) {
    saveCurrentPlayProgress();
  }
});

if (artPlayerRef.current?.video) {
  ensureVideoSource(
    artPlayerRef.current.video as HTMLVideoElement,
    videoUrl
  );
}
    } catch (err) {
  console.error('鍒涘缓鎾斁鍣ㄥけ璐?', err);
  // 閲嶇疆闆嗘暟鍒囨崲鏍囪瘑
  isEpisodeChangingRef.current = false;
  setError('鎾斁鍣ㄥ垵濮嬪寲澶辫触');
}
    }; // 缁撴潫 initPlayer 鍑芥暟

    */
/* LEGACY loadAndInit block - begin
// 鍔ㄦ€佸鍏?ArtPlayer 骞跺垵濮嬪寲
const loadAndInit = async () => {
  try {
      import('artplayer'),
      import('artplayer-plugin-danmuku')
    ]);
    
    // 灏嗗鍏ョ殑妯″潡璁剧疆涓哄叏灞€鍙橀噺渚?initPlayer 浣跨敤
    (window as any).DynamicArtplayer = Artplayer;
    
    await initPlayer();
  } catch (error) {
    console.error('鍔ㄦ€佸鍏?ArtPlayer 澶辫触:', error);
    setError('鎾斁鍣ㄥ姞杞藉け璐?);
  }
};

loadAndInit();
}, [Hls, videoUrl, loading, blockAdEnabled]);
*/

// 褰撶粍浠跺嵏杞芥椂娓呯悊瀹氭椂鍣ㄣ€乄ake Lock 鍜屾挱鏀惧櫒璧勬簮
useEffect(() => {
  return () => {
    // 娓呯悊瀹氭椂鍣?      if (saveIntervalRef.current) {
    clearInterval(saveIntervalRef.current);
  }

  // 娓呯悊寮瑰箷閲嶇疆瀹氭椂鍣?      if (seekResetTimeoutRef.current) {
  clearTimeout(seekResetTimeoutRef.current);
}

      // 娓呯悊resize闃叉姈瀹氭椂鍣?      if (resizeResetTimeoutRef.current) {
        clearTimeout(resizeResetTimeoutRef.current);
      }

// 閲婃斁 Wake Lock
releaseWakeLock();

// 娓呯悊WebSR
destroyWebSR();

// 閿€姣佹挱鏀惧櫒瀹炰緥
cleanupPlayer();
    };
  }, []);

// 杩斿洖椤堕儴鍔熻兘鐩稿叧
useEffect(() => {
  // 鑾峰彇婊氬姩浣嶇疆鐨勫嚱鏁?- 涓撻棬閽堝 body 婊氬姩
  const getScrollTop = () => {
    return document.body.scrollTop || 0;
  };

  // 浣跨敤 requestAnimationFrame 鎸佺画妫€娴嬫粴鍔ㄤ綅缃?    let isRunning = false;
  const checkScrollPosition = () => {
    if (!isRunning) return;

    const scrollTop = getScrollTop();
    const shouldShow = scrollTop > 300;
    setShowBackToTop(shouldShow);

    requestAnimationFrame(checkScrollPosition);
  };

  // 鍚姩鎸佺画妫€娴?    isRunning = true;
  checkScrollPosition();

  // 鐩戝惉 body 鍏冪礌鐨勬粴鍔ㄤ簨浠?    const handleScroll = () => {
  const scrollTop = getScrollTop();
  setShowBackToTop(scrollTop > 300);
};

document.body.addEventListener('scroll', handleScroll, { passive: true });

return () => {
  isRunning = false; // 鍋滄 requestAnimationFrame 寰幆
  // 绉婚櫎 body 婊氬姩浜嬩欢鐩戝惉鍣?      document.body.removeEventListener('scroll', handleScroll);
};
  }, []);

// 杩斿洖椤堕儴鍔熻兘
const scrollToTop = () => {
  try {
    // 鏍规嵁璋冭瘯缁撴灉锛岀湡姝ｇ殑婊氬姩瀹瑰櫒鏄?document.body
    document.body.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  } catch (error) {
    // 濡傛灉骞虫粦婊氬姩瀹屽叏澶辫触锛屼娇鐢ㄧ珛鍗虫粴鍔?      document.body.scrollTop = 0;
  }
};

if (loading) {
  return (
    <LoadingScreen
      loadingStage={loadingStage}
      loadingMessage={loadingMessage}
      speedTestProgress={speedTestProgress}
    />
  );
}

if (error) {
  return (
    <PageLayout activePath='/play'>
      <PlayErrorDisplay error={error} videoTitle={videoTitle} />
    </PageLayout>
  );
}

return (
    <>
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-[3rem] 2xl:px-20'>
        {/* 绗竴琛岋細褰辩墖鏍囬 */}
        <div className='py-1'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            {videoTitle || '褰辩墖鏍囬'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400'>
                {` > ${detail?.episodes_titles?.[currentEpisodeIndex] || `绗?${currentEpisodeIndex + 1} 闆哷}`}
              </span>
            )}
          </h1>
        </div>
        {/* 绗簩琛岋細鎾斁鍣ㄥ拰閫夐泦 */}
        <div className='space-y-2'>
          {/* 鎶樺彔鎺у埗 */}
          <div className='flex justify-end items-center gap-2 sm:gap-3'>
            {/* 缃戠洏璧勬簮鎸夐挳 */}
            <NetDiskButton
              videoTitle={videoTitle}
              netdiskLoading={netdiskLoading}
              netdiskTotal={netdiskTotal}
              netdiskResults={netdiskResults}
              onSearch={handleNetDiskSearch}
              onOpenModal={() => setShowNetdiskModal(true)}
            />

            {/* 涓嬭浇鎸夐挳 - 浣跨敤鐙珛缁勪欢浼樺寲鎬ц兘 */}
            <DownloadButtons
              downloadEnabled={downloadEnabled}
              onDownloadClick={() => setShowDownloadEpisodeSelector(true)}
              onDownloadPanelClick={() => setShowDownloadPanel(true)}
            />

            {/* 鎶樺彔鎺у埗鎸夐挳 - 浠呭湪 lg 鍙婁互涓婂睆骞曟樉绀?*/}
            <CollapseButton
              isCollapsed={isEpisodeSelectorCollapsed}
              onToggle={() => setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)}
            />
          </div>

          <div
            className={`grid gap-4 lg:h-[500px] xl:h-[650px] 2xl:h-[750px] transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
                  ? 'grid-cols-1'
                  : 'grid-cols-1 md:grid-cols-4'
                }`}
          >
                {/* 鎾斁鍣?*/}
                <div
                  className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
                    }`}
                >
                  <div className='relative w-full h-[300px] lg:h-full'>
                    <div
                      ref={artRef}
                      className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                    ></div>

                    {/* WebSR 鍒嗗睆瀵规瘮鍒嗗壊绾?*/}
                    {websrEnabled && websrCompareEnabled && (
                      <div
                        style={{
                          position: 'absolute',
                          left: `${websrComparePosition}%`,
                          top: 0,
                          bottom: 0,
                          width: '4px',
                          backgroundColor: 'white',
                          cursor: 'col-resize',
                          zIndex: 10,
                          transform: 'translateX(-50%)',
                        }}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                          const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                          if (!rect) return;
                          const x = e.clientX - rect.left;
                          const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
                          setWebsrComparePosition(pct);
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            backgroundColor: 'rgba(255,255,255,0.9)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px',
                            color: '#333',
                          }}
                        >
                          鈫?                    </div>
                      </div>
                    )}

                    {/* 璺宠繃璁剧疆鎸夐挳 - 鎾斁鍣ㄥ唴鍙充笂瑙?*/}
                    {currentSource && currentId && (
                      <div className='absolute top-4 right-4 z-10'>
                        <SkipSettingsButton onClick={() => setIsSkipSettingOpen(true)} />
                      </div>
                    )}

                    {/* SkipController 缁勪欢 */}
                    {currentSource && currentId && detail?.title && (
                      <SkipController
                        source={currentSource}
                        id={currentId}
                        title={detail.title}
                        episodeIndex={currentEpisodeIndex}
                        artPlayerRef={artPlayerRef}
                        currentTime={currentPlayTime}
                        duration={videoDuration}
                        isSettingMode={isSkipSettingOpen}
                        onSettingModeChange={setIsSkipSettingOpen}
                        onNextEpisode={handleNextEpisode}
                      />
                    )}

                    {/* 鎹㈡簮鍔犺浇钂欏眰 */}
                    <VideoLoadingOverlay
                      isVisible={isVideoLoading}
                      loadingStage={videoLoadingStage}
                    />
                  </div>
                </div>

                {/* 閫夐泦鍜屾崲婧?- 鍦ㄧЩ鍔ㄧ濮嬬粓鏄剧ず锛屽湪 lg 鍙婁互涓婂彲鎶樺彔 */}
                <div
                  className={`h-[300px] lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${isEpisodeSelectorCollapsed
                    ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                    : 'md:col-span-1 lg:opacity-100 lg:scale-100'
                    }`}
                >
                  <EpisodeSelector
                    totalEpisodes={totalEpisodes}
                    episodes_titles={detail?.episodes_titles || []}
                    value={currentEpisodeIndex + 1}
                    onChange={handleEpisodeChange}
                    onSourceChange={handleSourceChange}
                    currentSource={currentSource}
                    currentId={currentId}
                    videoTitle={searchTitle || videoTitle}
                    availableSources={availableSources.filter(source => {
                      // 蹇呴』鏈夐泦鏁版暟鎹紙鎵€鏈夋簮鍖呮嫭鐭墽婧愰兘蹇呴』婊¤冻锛?                  if (!source.episodes || source.episodes.length < 1) return false;

                      // 鐭墽婧愪笉鍙楅泦鏁板樊寮傞檺鍒讹紙浣嗗繀椤绘湁闆嗘暟鏁版嵁锛?                  if (source.source === 'shortdrama') return true;

                      // 濡傛灉褰撳墠鏈?detail锛屽彧鏄剧ず闆嗘暟鐩歌繎鐨勬簮锛堝厑璁?卤30% 鐨勫樊寮傦級
                      if (detail && detail.episodes && detail.episodes.length > 0) {
                        const currentEpisodes = detail.episodes.length;
                        const sourceEpisodes = source.episodes.length;
                        const tolerance = Math.max(5, Math.ceil(currentEpisodes * 0.3)); // 鑷冲皯5闆嗙殑瀹瑰樊

                        // 鍦ㄥ悎鐞嗚寖鍥村唴
                        return Math.abs(sourceEpisodes - currentEpisodes) <= tolerance;
                      }

                      return true;
                    })}
                    sourceSearchLoading={sourceSearchLoading}
                    sourceSearchError={sourceSearchError}
                    precomputedVideoInfo={precomputedVideoInfo}
                  />
                </div>
              </div>
        </div>

        {/* 璇︽儏灞曠ず */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 鏂囧瓧鍖?- 浣跨敤鐙珛缁勪欢浼樺寲鎬ц兘 */}
          <VideoInfoSection
            videoTitle={videoTitle}
            videoYear={videoYear}
            videoCover={videoCover}
            videoDoubanId={videoDoubanId}
            currentSource={currentSource}
            favorited={favorited}
            onToggleFavorite={handleToggleFavorite}
            detail={detail}
            movieDetails={movieDetails}
            bangumiDetails={bangumiDetails}
            shortdramaDetails={shortdramaDetails}
            movieComments={movieComments}
            commentsError={commentsError?.message || null}
            loadingMovieDetails={loadingMovieDetails}
            loadingBangumiDetails={loadingBangumiDetails}
            loadingComments={loadingComments}
            loadingCelebrityWorks={loadingCelebrityWorks}
            selectedCelebrityName={selectedCelebrityName}
            celebrityWorks={celebrityWorks}
            onCelebrityClick={handleCelebrityClick}
            onClearCelebrity={() => {
              setSelectedCelebrityName(null);
              setCelebrityWorks([]);
            }}
            processImageUrl={processImageUrl}
          />

          {/* 灏侀潰灞曠ず */}
          <VideoCoverDisplay
            videoCover={videoCover}
            bangumiDetails={bangumiDetails}
            videoTitle={videoTitle}
            videoDoubanId={videoDoubanId}
            processImageUrl={processImageUrl}
          />
        </div>
      </div>

      {/* 杩斿洖椤堕儴鎮诞鎸夐挳 - 浣跨敤鐙珛缁勪欢浼樺寲鎬ц兘 */}
      <BackToTopButton show={showBackToTop} onClick={scrollToTop} />

      {/* 瑙傚奖瀹ゅ悓姝ユ殏鍋滄彁绀烘潯 */}
      <WatchRoomSyncBanner
        show={isInWatchRoom && !isWatchRoomOwner && syncPaused && !pendingOwnerChange}
        onResumeSync={resumeSync}
      />

      {/* 婧愬垏鎹㈢‘璁ゅ璇濇 */}
      <SourceSwitchDialog
        show={showSourceSwitchDialog && !!pendingOwnerState}
        ownerSource={pendingOwnerState?.source || ''}
        onConfirm={handleConfirmSourceSwitch}
        onCancel={handleCancelSourceSwitch}
      />

      {/* 鎴夸富鍒囨崲瑙嗛/闆嗘暟纭妗?*/}
      <OwnerChangeDialog
        show={!!pendingOwnerChange}
        videoName={pendingOwnerChange?.videoName || ''}
        episode={pendingOwnerChange?.episode || 0}
        onConfirm={confirmFollowOwner}
        onReject={rejectFollowOwner}
      />

      {/* 馃帹 缇庡寲鐨勫脊骞曡缃潰鏉?- Portal 鍒?ArtPlayer $player 鏀寔鍏ㄥ睆 */}
        <div style={{ all: 'initial', fontFamily: 'Inter, system-ui, sans-serif', position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
          <style>{`.danmu-iso svg { fill: none !important; }`}</style>
          <div className="danmu-iso" style={{ pointerEvents: 'auto' }}>
            <DanmuSettingsPanel
              settings={{
                enabled:, // 鍚敤寮瑰箷涓诲紑鍏?                fontSize: parseInt(localStorage.getItem('danmaku_fontSize') || '25'),
                speed: parseFloat(localStorage.getItem('danmaku_speed') || '5'),
                opacity: parseFloat(localStorage.getItem('danmaku_opacity') || '0.8'),
                margin: JSON.parse(localStorage.getItem('danmaku_margin') || '[10, "75%"]'),
                modes: JSON.parse(localStorage.getItem('danmaku_modes') || '[0, 1, 2]') as Array<0 | 1 | 2>,
                antiOverlap: localStorage.getItem('danmaku_antiOverlap') !== null
                  ? localStorage.getItem('danmaku_antiOverlap') === 'true'
                  : true, // 榛樿寮€鍚槻閲嶅彔
                visible: localStorage.getItem('danmaku_visible') !== 'false',
              }}
              matchInfo={
                detail?.title && currentEpisodeIndex >= 0
                  ? {
                    animeTitle: detail.title,
                    episodeTitle: `绗?${currentEpisodeIndex + 1} 闆哷,
                    }
                  : null
              }
              onSettingsChange={(newSettings) => {
                // 鏇存柊鍚敤鐘舵€?                if (newSettings.enabled !== undefined) {
                }

                // 鏇存柊 localStorage
                if (newSettings.fontSize !== undefined) {
                  localStorage.setItem('danmaku_fontSize', String(newSettings.fontSize));
                }
                if (newSettings.speed !== undefined) {
                  localStorage.setItem('danmaku_speed', String(newSettings.speed));
                }
                if (newSettings.opacity !== undefined) {
                  localStorage.setItem('danmaku_opacity', String(newSettings.opacity));
                }
                if (newSettings.margin !== undefined) {
                  localStorage.setItem('danmaku_margin', JSON.stringify(newSettings.margin));
                }
                if (newSettings.modes !== undefined) {
                  localStorage.setItem('danmaku_modes', JSON.stringify(newSettings.modes));
                }
                if (newSettings.antiOverlap !== undefined) {
                  localStorage.setItem('danmaku_antiOverlap', String(newSettings.antiOverlap));
                }
                if (newSettings.visible !== undefined) {
                  localStorage.setItem('danmaku_visible', String(newSettings.visible));
                }

                // 瀹炴椂鏇存柊寮瑰箷鎻掍欢閰嶇疆

                  // 澶勭悊鏄剧ず/闅愯棌
                  if (newSettings.visible !== undefined) {
                    if (newSettings.visible) {
                    } else {
                    }
                  }
                }

                // 瑙﹀彂闈㈡澘閲嶆柊璇诲彇璁剧疆锛堥€氳繃 key 鍙樺寲锛?                setDanmuSettingsVersion(v => v + 1);
              }}
              loadMeta={danmuLoadMeta}
              error={danmuError}
              onReload={async () => {
                // 閲嶆柊鍔犺浇澶栭儴寮瑰箷锛堝己鍒跺埛鏂帮級
                  danmuPlugin.load(); // 娓呯┖宸叉湁寮瑰箷
                  danmuPlugin.load(result.data);
                  if (result.count > 0) {
                    artPlayerRef.current.notice.show = `宸插姞杞?${result.count} 鏉″脊骞昤;
                  } else {
              artPlayerRef.current.notice.show = '鏆傛棤寮瑰箷鏁版嵁';
                  }
                }
            return result.count;
              }}
            onManualMatch={() => {
              setIsDanmuManualModalOpen(true);
            }}
            onClearManualMatch={async () => {
              setManualDanmuOverrides((prev) => {
                const next = { ...prev };
                return next;
              });
              // Reload with auto matching
                danmuPlugin.load(); // 娓呯┖宸叉湁寮瑰箷
                danmuPlugin.load(result.data);
                artPlayerRef.current.notice.show = result.count > 0
                  ? `宸叉仮澶嶈嚜鍔ㄥ尮閰嶏紝鍔犺浇 ${result.count} 鏉″脊骞昤
                    : '宸叉仮澶嶈嚜鍔ㄥ尮閰嶏紝鏆傛棤寮瑰箷';
                }
              }}
            />
          </div>
        </div>,
        portalContainer
      )}

      {/* 鎵嬪姩鍖归厤寮瑰箷寮圭獥 */}
        isOpen={isDanmuManualModalOpen}
        defaultKeyword={videoTitle}
        currentEpisode={currentEpisodeIndex + 1}
        portalContainer={portalContainer}
        onClose={() => setIsDanmuManualModalOpen(false)}
        onApply={async (selection) => {
          setManualDanmuOverrides((prev) => ({
            ...prev,
          }));
          setIsDanmuManualModalOpen(false);

          const override: DanmuManualOverride = {
            animeId: selection.animeId,
            episodeId: selection.episodeId,
            animeTitle: selection.animeTitle,
            episodeTitle: selection.episodeTitle,
          };
            danmuPlugin.load(); // 娓呯┖宸叉湁寮瑰箷
            danmuPlugin.load(result.data);
            artPlayerRef.current.notice.show = result.count > 0
              ? `宸叉墜鍔ㄥ尮閰 ? ${ selection.animeTitle } 路 ${ selection.episodeTitle } (${ result.count } 鏉 ? `
              : `宸叉墜鍔ㄥ尮閰嶏紝浣嗚闆嗘殏鏃犲脊骞昤;
          }
        }}
      />

            {/* WebSR 璁剧疆闈㈡澘 */}
            {isWebSRSettingsPanelOpen && portalContainer && createPortal(
              <div style={{ all: 'initial', fontFamily: 'Inter, system-ui, sans-serif', position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
                <style>{`.websr-iso svg { fill: none !important; }`}</style>
                <div className="websr-iso" style={{ pointerEvents: 'auto' }}>
                  <WebSRSettingsPanel
                    isOpen={isWebSRSettingsPanelOpen}
                    onClose={() => setIsWebSRSettingsPanelOpen(false)}
                    settings={{
                      enabled: websrEnabled,
                      mode: websrMode,
                      contentType: websrContentType,
                      networkSize: websrNetworkSize,
                      compareEnabled: websrCompareEnabled,
                      comparePosition: 50,
                    }}
                    onSettingsChange={async (newSettings) => {
                      // 鏇存柊鍚敤鐘舵€?                if (newSettings.enabled !== undefined) {
                      await toggleWebSR(newSettings.enabled);
                    }

                // 鏇存柊妯″紡
                if (newSettings.mode !== undefined) {
                    setWebsrMode(newSettings.mode);
                  localStorage.setItem('websr_mode', newSettings.mode);
                  await switchWebSRConfig();
                }

                  // 鏇存柊鍐呭绫诲瀷
                  if (newSettings.contentType !== undefined) {
                    setWebsrContentType(newSettings.contentType);
                  localStorage.setItem('websr_content_type', newSettings.contentType);
                  await switchWebSRConfig();
                }

                  // 鏇存柊鐢昏川绛夌骇
                  if (newSettings.networkSize !== undefined) {
                    setWebsrNetworkSize(newSettings.networkSize);
                  localStorage.setItem('websr_network_size', newSettings.networkSize);
                  await switchWebSRConfig();
                }

                  // 鏇存柊瀵规瘮妯″紡
                  if (newSettings.compareEnabled !== undefined) {
                    setWebsrCompareEnabled(newSettings.compareEnabled);
                }
              }}
                  webGPUSupported={webGPUSupported}
                  processing={false}
            />
                </div>
              </div>,
              portalContainer
            )}
          </PageLayout>

          {/* 缃戠洏璧勬簮妯℃€佹 */}
          {showNetdiskModal && (
            <div
              className='fixed inset-0 z-9999 bg-black/50 flex items-end md:items-center justify-center p-0 md:p-4'
              onClick={() => setShowNetdiskModal(false)}
            >
              <div
                className='bg-white dark:bg-gray-800 rounded-t-2xl md:rounded-2xl w-full md:max-w-4xl max-h-[85vh] md:max-h-[90vh] flex flex-col shadow-2xl'
                onClick={(e) => e.stopPropagation()}
              >
                {/* 澶撮儴 - Fixed */}
                <div className='shrink-0 border-b border-gray-200 dark:border-gray-700 p-4 sm:p-6'>
                  <div className='flex items-center justify-between mb-3'>
                    <div className='flex items-center gap-2 sm:gap-3'>
                      <div className='text-2xl sm:text-3xl'>馃搧</div>
                      <div>
                        <h3 className='text-lg sm:text-xl font-semibold text-gray-800 dark:text-gray-200'>
                          璧勬簮鎼滅储
                        </h3>
                        {videoTitle && (
                          <p className='text-xs sm:text-sm text-gray-500 dark:text-gray-400 mt-0.5'>
                            鎼滅储鍏抽敭璇嶏細{videoTitle}
                          </p>
                        )}
                      </div>
                      {netdiskLoading && netdiskResourceType === 'netdisk' && (
                        <span className='inline-block ml-2'>
                          <span className='inline-block h-4 w-4 sm:h-5 sm:w-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin'></span>
                        </span>
                      )}
                      {netdiskTotal > 0 && netdiskResourceType === 'netdisk' && (
                        <span className='inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 ml-2'>
                          {netdiskTotal} 涓祫婧?                    </span>
                      )}
                    </div>
                    <button
                      onClick={() => setShowNetdiskModal(false)}
                      className='rounded-lg p-1.5 sm:p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors active:scale-95'
                      aria-label='鍏抽棴'
                    >
                      <X className='h-5 w-5 sm:h-6 sm:w-6 text-gray-500' />
                    </button>
                  </div>

                  {/* 璧勬簮绫诲瀷鍒囨崲鍣?- 浠呭綋鏄姩婕椂鏄剧ず */}
                  {(() => {
                    const typeName = detail?.type_name?.toLowerCase() || '';
                    const isAnime = typeName.includes('鍔ㄦ极') ||
                      typeName.includes('鍔ㄧ敾') ||
                      typeName.includes('anime') ||
                      typeName.includes('鐣墽') ||
                      typeName.includes('鏃ュ墽') ||
                      typeName.includes('闊╁墽');

                    console.log('[NetDisk] type_name:', detail?.type_name, 'isAnime:', isAnime);

                    return isAnime && (
                      <div className='flex items-center gap-2'>
                        <span className='text-xs sm:text-sm text-gray-600 dark:text-gray-400'>璧勬簮绫诲瀷锛?/span>
                          <div className='flex gap-2'>
                            <button
                              onClick={() => {
                                setNetdiskResourceType('netdisk');
                                setNetdiskResults(null);
                                setNetdiskError(null);
                              }}
                              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-lg border transition-all ${netdiskResourceType === 'netdisk'
                                  ? 'bg-blue-500 text-white border-blue-500 shadow-md'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'
                                }`}
                            >
                              馃捑 缃戠洏璧勬簮
                            </button>
                            <button
                              onClick={() => {
                                setNetdiskResourceType('acg');
                                setNetdiskResults(null);
                                setNetdiskError(null);
                                if (videoTitle) {
                                  setAcgTriggerSearch(prev => !prev);
                                }
                              }}
                              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium rounded-lg border transition-all ${netdiskResourceType === 'acg'
                                  ? 'bg-purple-500 text-white border-purple-500 shadow-md'
                                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-600'
                                }`}
                            >
                              馃帉 鍔ㄦ极纾佸姏
                            </button>
                          </div>
                      </div>
                    );
                  })()}
                </div>

                {/* 鍐呭鍖?- Scrollable */}
                <div ref={netdiskModalContentRef} className='flex-1 overflow-y-auto p-4 sm:p-6 relative'>
                  {/* 鏍规嵁璧勬簮绫诲瀷鏄剧ず涓嶅悓鐨勫唴瀹?*/}
                  {netdiskResourceType === 'netdisk' ? (
                    <>
                      {videoTitle && !netdiskLoading && !netdiskResults && !netdiskError && (
                        <div className='flex flex-col items-center justify-center py-12 sm:py-16 text-center'>
                          <div className='text-5xl sm:text-6xl mb-4'>馃搧</div>
                          <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
                            鐐瑰嚮鎼滅储鎸夐挳寮€濮嬫煡鎵剧綉鐩樿祫婧?                      </p>
                          <button
                            onClick={() => handleNetDiskSearch(videoTitle)}
                            disabled={netdiskLoading}
                            className='mt-4 px-4 sm:px-6 py-2 sm:py-2.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors disabled:opacity-50 text-sm sm:text-base font-medium'
                          >
                            寮€濮嬫悳绱?                      </button>
                        </div>
                      )}

                      <NetDiskSearchResults
                        results={netdiskResults}
                        loading={netdiskLoading}
                        error={netdiskError}
                        total={netdiskTotal}
                      />

                    </>
                  ) : (
                    /* ACG 鍔ㄦ极纾佸姏鎼滅储 */
                    <AcgSearch
                      keyword={videoTitle || ''}
                      triggerSearch={acgTriggerSearch}
                      onError={(error) => console.error('ACG鎼滅储澶辫触:', error)}
                    />
                  )}

                  {/* 杩斿洖椤堕儴鎸夐挳 - 缁熶竴鏀惧湪澶栧眰锛岄€傜敤浜庢墍鏈夎祫婧愮被鍨?*/}
                  {((netdiskResourceType === 'netdisk' && netdiskTotal > 10) ||
                    (netdiskResourceType === 'acg')) && (
                      <button
                        onClick={() => {
                          if (netdiskModalContentRef.current) {
                            netdiskModalContentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                          }
                        }}
                        className={`sticky bottom-6 left-full -ml-14 sm:bottom-8 sm:-ml-16 w-11 h-11 sm:w-12 sm:h-12 ${netdiskResourceType === 'acg'
                            ? 'bg-purple-500 hover:bg-purple-600'
                            : 'bg-blue-500 hover:bg-blue-600'
                          } text-white rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center justify-center active:scale-95 z-50 group`}
                        aria-label='杩斿洖椤堕儴'
                      >
                        <svg className='w-5 h-5 sm:w-6 sm:h-6 group-hover:translate-y-[-2px] transition-transform' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                          <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2.5} d='M5 10l7-7m0 0l7 7m-7-7v18' />
                        </svg>
                      </button>
                    )}
                </div>
              </div>
            </div>
          )}

          {/* 涓嬭浇閫夐泦闈㈡澘 */}
          <DownloadEpisodeSelector
            isOpen={showDownloadEpisodeSelector}
            onClose={() => setShowDownloadEpisodeSelector(false)}
            totalEpisodes={detail?.episodes?.length || 1}
            episodesTitles={detail?.episodes_titles || []}
            videoTitle={videoTitle || '瑙嗛'}
            currentEpisodeIndex={currentEpisodeIndex}
            onDownload={async (episodeIndexes) => {
              if (!detail?.episodes || detail.episodes.length === 0) {
                // 鍗曢泦瑙嗛锛岀洿鎺ヤ笅杞藉綋鍓?          const currentUrl = videoUrl;
                if (!currentUrl) {
                  toast.error('鏃犳硶鑾峰彇瑙嗛鍦板潃');
                  return;
                }
                if (!currentUrl.includes('.m3u8')) {
                  toast.error('浠呮敮鎸丮3U8鏍煎紡瑙嗛涓嬭浇');
                  return;
                }
                try {
                  // 浠?M3U8 URL 鎻愬彇 origin 鍜?referer
                  const urlObj = new URL(currentUrl);
                  const origin = `${urlObj.protocol}//${urlObj.host}`;
                  const referer = currentUrl;

                  await createTask(currentUrl, videoTitle || '瑙嗛', 'TS', {
                    referer,
                    origin,
                  });

                  // 鏄剧ず Toast 閫氱煡
                  toast.success('涓嬭浇宸插紑濮?, {
              description: videoTitle || '瑙嗛',
          action: {
            label: '鏌ョ湅涓嬭浇',
                onClick: () => setShowDownloadPanel(true)
              },
          duration: 5000,
            });
          } catch (error) {
            console.error('鍒涘缓涓嬭浇浠诲姟澶辫触:', error);
          toast.error('鍒涘缓涓嬭浇浠诲姟澶辫触', {
            description: (error as Error).message,
          duration: 5000,
            });
          }
          return;
        }

          // 鎵归噺涓嬭浇澶氶泦 - 绔嬪嵆鏄剧ず toast
          const taskCount = episodeIndexes.length;
          toast.success('涓嬭浇宸插紑濮?, {
            description: taskCount === 1
          ? `${videoTitle || '瑙嗛'}_绗?{episodeIndexes[0] + 1}闆哷
          : `姝ｅ湪娣诲姞 ${taskCount} 涓笅杞戒换鍔?..`,
          action: {
            label: '鏌ョ湅涓嬭浇',
            onClick: () => setShowDownloadPanel(true)
          },
          duration: 5000,
        });

          let successCount = 0;
          let hasAttempted = false;
          for (const episodeIndex of episodeIndexes) {
            hasAttempted = true;
          try {
            let episodeUrl = detail.episodes[episodeIndex];
          if (!episodeUrl) continue;

          // 妫€鏌ユ槸鍚︿负鐭墽鏍煎紡锛岄渶瑕佸厛瑙ｆ瀽
          if (episodeUrl.startsWith('shortdrama:')) {
              try {
                const [, videoId, episode] = episodeUrl.split(':');
          const nameParam = detail.drama_name ? `&name=${encodeURIComponent(detail.drama_name)}` : '';
          const response = await fetch(
          `/api/shortdrama/parse?id=${videoId}&episode=${episode}${nameParam}`
          );

          if (response.ok) {
                  const result = await response.json();
          episodeUrl = result.url || '';
          if (!episodeUrl) {
            console.warn(`绗?{episodeIndex + 1}闆嗚В鏋愬け璐ワ紝璺宠繃`);
          continue;
                  }
                } else {
            console.warn(`绗?{episodeIndex + 1}闆嗚В鏋愬け璐ワ紝璺宠繃`);
          continue;
                }
              } catch (parseError) {
            console.error(`绗?{episodeIndex + 1}闆嗙煭鍓RL瑙ｆ瀽澶辫触:`, parseError);
          continue;
              }
            }

          // 妫€鏌ユ槸鍚︽槸M3U8
          if (!episodeUrl.includes('.m3u8')) {
            console.warn(`绗?{episodeIndex + 1}闆嗕笉鏄疢3U8鏍煎紡锛岃烦杩嘸);
              continue;
            }

            const episodeName = `绗 ? { episodeIndex + 1}闆哷;
          const downloadTitle = `${videoTitle || '瑙嗛'}_${episodeName}`;

          // 浠?M3U8 URL 鎻愬彇 origin 鍜?referer
          const urlObj = new URL(episodeUrl);
          const origin = `${urlObj.protocol}//${urlObj.host}`;
          const referer = episodeUrl;

          await createTask(episodeUrl, downloadTitle, 'TS', {
            referer,
            origin,
            });
          successCount++;
          } catch (error) {
            console.error(`鍒涘缓绗?{episodeIndex + 1}闆嗕笅杞戒换鍔″け璐?`, error);
          }
        }

        // 濡傛灉鏈夊け璐ョ殑浠诲姟锛屾樉绀洪敊璇彁绀?        if (successCount === 0 && hasAttempted) {
            toast.error('涓嬭浇澶辫触', {
              description: '鏃犳硶鍒涘缓涓嬭浇浠诲姟锛岃鏌ョ湅鎺у埗鍙颁簡瑙ｈ鎯?,
            duration: 5000,
            });
        } else if (successCount < taskCount) {
            toast.warning('閮ㄥ垎浠诲姟鍒涘缓澶辫触', {
              description: `鎴愬姛娣诲姞 ${successCount}/${taskCount} 涓笅杞戒换鍔,
            duration: 5000,
          });
        }
      }}
      />
    </>
  );
}


export default function PlayPage() {
  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <PlayPageClientWrapper />
      </Suspense>
    </>
  );
}

function PlayPageClientWrapper() {
  const searchParams = useSearchParams();
  // 浣跨敤 source + id 浣滀负 key锛屽己鍒跺湪鍒囨崲婧愭椂閲嶆柊鎸傝浇缁勪欢
  // 鍙傝€冿細https://github.com/vercel/next.js/issues/2819
  const key = `${ searchParams.get('source') } - ${ searchParams.get('id') } - ${ searchParams.get('_reload') || '' }`;

  return <PlayPageClient key={key} />;
}

