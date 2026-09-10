import { REGIONS_DATA, getTotalWeight } from './data/regions.js';

// 상태 관리
let calculationMode = 'birth'; // 'birth' (출생아 기준) | 'population' (인구 기준)
let currentFilter = 'all'; // 'all', 'non-capital', 'rural-only'
let reincarnationCount = 0;
let history = [];
let currentRegion = null;

// Leaflet 지도 인스턴스 및 현재 마커 객체
let leafletMap = null;
let currentMapMarker = null;

// 대한민국 총 인구 (통계청 등록인구 기준 약 5,130만 명)
const TOTAL_KOREA_POPULATION = 51300000;

// 대한민국 전도 기본 중심점 (충청북도 영동 부근) 및 줌 레벨
const KOREA_CENTER_LAT = 35.95;
const KOREA_CENTER_LNG = 127.85;
const KOREA_DEFAULT_ZOOM = 7;

/**
 * 필터링 적용된 지자체 목록 반환
 */
function getFilteredRegions() {
  if (currentFilter === 'non-capital') {
    return REGIONS_DATA.filter(r => !r.tags.includes('수도권'));
  }
  
  if (currentFilter === 'rural-only') {
    return REGIONS_DATA.filter(r => {
      // 1. 서울특별시, 광역시는 무조건 배제
      if (r.province === '서울특별시' || r.province.includes('광역시')) {
        return false;
      }
      // 2. 수도권(서울/경기/인천) 배제
      if (r.tags.includes('수도권')) {
        return false;
      }
      // 3. 대도시, 특례시 태그 배제
      if (r.tags.includes('대도시') || r.tags.includes('특례시')) {
        return false;
      }
      // 4. 순수 군(郡) 지역이거나 인구 10만 이하의 소도시만 허용
      const isGun = r.city.endsWith('군') || r.tags.includes('군지역');
      const isSmallCity = r.population <= 100000;
      return isGun || isSmallCity;
    });
  }

  return REGIONS_DATA;
}

// 가중치(출생아 또는 인구)에 비례한 랜덤 선택 알고리즘
function selectWeightedRandomRegion(pool) {
  const totalWeight = getTotalWeight(pool, calculationMode);
  let randomVal = Math.random() * totalWeight;

  for (const region of pool) {
    const weight = calculationMode === 'population' ? region.population : region.annualBirths;
    if (randomVal < weight) {
      return region;
    }
    randomVal -= weight;
  }
  return pool[pool.length - 1];
}

// 확률 계산 헬퍼
function calculateChance(region, pool) {
  const totalWeight = getTotalWeight(pool, calculationMode);
  const currentVal = calculationMode === 'population' ? region.population : region.annualBirths;
  const percentage = ((currentVal / totalWeight) * 100).toFixed(2);
  const oneInX = Math.max(1, Math.round(totalWeight / currentVal)).toLocaleString();
  return { percentage, oneInX };
}

// 인구 비율 계산 헬퍼
function calculatePopulationShare(population) {
  return ((population / TOTAL_KOREA_POPULATION) * 100).toFixed(2);
}

// 대한민국 전도 (제주도 마라도부터 강원 고성, 백령도부터 독도까지) 바운드
const KOREA_BOUNDS = [
  [33.0, 124.6], // 남서쪽 (마라도/제주도 남단 및 백령도 서단 여백)
  [38.5, 131.9]  // 북동쪽 (휴전선 고성 북단 및 독도 동단 여백)
];

/**
 * Leaflet.js 대한민국 전도 고정 지도 초기화 함수
 */
function initRealLeafletMap() {
  const mapContainer = document.getElementById('real-leaflet-map');
  if (!mapContainer || !window.L) return;

  // Leaflet 대한민국 전도 고정 지도 생성 (지도 자체는 고정, 마커만 움직임)
  leafletMap = L.map('real-leaflet-map', {
    zoomControl: false,
    dragging: false,
    touchZoom: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    attributionControl: false
  });

  // 실제 전세계/대한민국 표준 다크 타일레이어 (CartoDB DarkMatter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(leafletMap);

  // 대한민국 전체(서울~제주, 독도)가 한눈에 들어오도록 뷰포트 고정
  leafletMap.fitBounds(KOREA_BOUNDS, { padding: [8, 8] });

  // 창 크기 변경 시에도 대한민국 전도 비율 유지
  window.addEventListener('resize', () => {
    if (leafletMap) {
      leafletMap.invalidateSize();
      leafletMap.fitBounds(KOREA_BOUNDS, { padding: [8, 8] });
    }
  });
}

/**
 * 실제 지리 지도 상에 환생 지자체 마커 갱신 (지도는 고정, 마커만 이동)
 */
function updateLeafletMapPin(region) {
  if (!leafletMap || !window.L || typeof region?.lat !== 'number' || typeof region?.lng !== 'number' || isNaN(region.lat) || isNaN(region.lng)) return;

  const coordDisplay = document.getElementById('coord-display');
  const statusDot = document.getElementById('map-status-dot');
  const accentColor = region.themeColor?.accent || '#ec4899';

  if (coordDisplay) {
    coordDisplay.innerText = `${region.lat.toFixed(4)}°N, ${region.lng.toFixed(4)}°E`;
  }
  if (statusDot) {
    statusDot.style.backgroundColor = accentColor;
    statusDot.style.boxShadow = `0 0 10px ${accentColor}`;
  }

  // 지도는 대한민국 전체 뷰로 고정된 상태에서, 출생 지점 핀(마커)만 이동
  const customIcon = L.divIcon({
    className: 'custom-leaflet-pin',
    html: `
      <div class="pin-inner-wrapper" style="color: ${accentColor};">
        <div class="pin-pulse-wave"></div>
        <div class="pin-pulse-wave pin-pulse-wave-delayed"></div>
        <div class="pin-core-dot" style="background-color: ${accentColor}; border-color: #ffffff;"></div>
        <div class="pin-floating-badge" style="border-color: ${accentColor};">
          ${region.province.split(' ')[0]} ${region.city.split(' ')[0]}
        </div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  });

  if (currentMapMarker) {
    currentMapMarker.setLatLng([region.lat, region.lng]);
    currentMapMarker.setIcon(customIcon);
  } else {
    currentMapMarker = L.marker([region.lat, region.lng], { icon: customIcon }).addTo(leafletMap);
  }
}

// UI 렌더링
function renderResult(region, pool) {
  const titleProvince = document.getElementById('res-province');
  const titleCity = document.getElementById('res-city');
  const rarityBadge = document.getElementById('res-rarity');
  const description = document.getElementById('res-description');
  const statsContainer = document.getElementById('res-stats');
  const tagsContainer = document.getElementById('res-tags');
  const cardTopGlow = document.getElementById('card-top-glow');
  const ambientGlow = document.getElementById('ambient-glow');

  // 지자체 테마 색상 적용
  if (region.themeColor) {
    if (cardTopGlow) {
      cardTopGlow.style.background = `linear-gradient(90deg, ${region.themeColor.from}, ${region.themeColor.to})`;
    }
    if (ambientGlow) {
      ambientGlow.style.background = `radial-gradient(circle, ${region.themeColor.from}40 0%, ${region.themeColor.to}20 60%, transparent 80%)`;
    }
  }

  // 희귀도 뱃지 스타일링
  const rarityClasses = {
    'SSR': 'badge-ssr',
    'SR': 'badge-sr',
    'R': 'badge-r',
    'Common': 'badge-common'
  };
  rarityBadge.className = `px-3 py-1 rounded-full text-xs font-black tracking-wider uppercase ${rarityClasses[region.rarity] || 'badge-common'}`;
  rarityBadge.innerText = region.rarity === 'SSR' ? '🌟 SSR 초희귀' : region.rarity === 'SR' ? '✨ SR 희귀' : region.rarity === 'R' ? '🔷 R 일반' : '⚪ 흔함 (Common)';

  // 지명 및 설명
  titleProvince.innerText = region.province;
  titleCity.innerText = region.city;
  description.innerText = region.description;

  // 상단 스크롤 고정 바 갱신 (출생지역, 소속자치단체, 희귀도만 표시)
  const stickyProvince = document.getElementById('sticky-province');
  const stickyCity = document.getElementById('sticky-city');
  const stickyRarity = document.getElementById('sticky-rarity');
  if (stickyProvince) stickyProvince.innerText = region.province;
  if (stickyCity) stickyCity.innerText = region.city;
  if (stickyRarity) {
    stickyRarity.className = `px-2.5 py-0.5 rounded-full text-[11px] sm:text-xs font-black tracking-wider shadow-sm ${rarityClasses[region.rarity] || 'badge-common'}`;
    stickyRarity.innerText = region.rarity === 'SSR' ? '🌟 SSR' : region.rarity === 'SR' ? '✨ SR' : region.rarity === 'R' ? '🔷 R' : '⚪ 흔함';
  }

  // 태그 렌더링
  tagsContainer.innerHTML = region.tags.map(t => 
    `<span class="text-xs px-2.5 py-1 rounded-lg bg-slate-800/90 text-slate-300 border border-slate-700 font-medium">#${t}</span>`
  ).join(' ');

  // 통계 계산
  const { percentage, oneInX } = calculateChance(region, pool);
  const popShare = calculatePopulationShare(region.population);

  // 모드별 대표 확률 라벨
  const chanceLabel = calculationMode === 'birth' 
    ? { title: '👶 연간 출생아 & 환생 확률', value: `연간 약 ${region.annualBirths.toLocaleString()}명 (약 ${oneInX}번 중 1번, ${percentage}%)` }
    : { title: '👥 거주 인구 & 추첨 확률', value: `약 ${(region.population / 10000).toFixed(1)}만 명 (전국의 ${popShare}%, 약 ${oneInX}번 중 1번)` };

  const secondaryLabel = calculationMode === 'birth'
    ? { title: '👥 인구 및 전국 비중', value: `약 ${(region.population / 10000).toFixed(1)}만 명 (전국의 ${popShare}%)` }
    : { title: '👶 연간 출생아 수', value: `약 ${region.annualBirths.toLocaleString()}명 (전국 약 23만 명 중)` };

  const allStats = [
    { icon: calculationMode === 'birth' ? '👶' : '👥', label: chanceLabel.title, value: chanceLabel.value, highlight: true },
    { icon: calculationMode === 'birth' ? '👥' : '👶', label: secondaryLabel.title, value: secondaryLabel.value, highlight: false },
    ...region.stats.map(s => ({
      icon: '📊',
      label: s.label,
      value: s.value,
      highlight: false
    }))
  ];

  // 다채로운 통계 리스트 렌더링
  statsContainer.innerHTML = allStats.map((s, idx) => `
    <div class="flex items-start gap-3 text-sm sm:text-base leading-relaxed p-3 rounded-2xl ${
      s.highlight 
        ? 'bg-gradient-to-r from-pink-950/40 via-purple-950/30 to-indigo-950/40 border border-pink-500/50 shadow-md shadow-pink-950/30' 
        : idx % 2 === 0 
          ? 'bg-slate-800/50 border border-slate-700/50' 
          : 'bg-slate-900/50 border border-slate-700/40'
    }">
      <span class="text-lg select-none">${s.icon}</span>
      <div class="flex-1 flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1">
        <span class="font-bold ${s.highlight ? 'text-pink-200' : 'text-slate-300'}">${s.label}</span>
        <span class="${s.highlight ? 'text-pink-100 font-extrabold text-base' : 'text-white font-semibold'} sm:text-right">${s.value}</span>
      </div>
    </div>
  `).join('');

  // 실제 지도 핀 동기화
  updateLeafletMapPin(region, true);

  // SSR인 경우 특별 축하 폭죽
  if (region.rarity === 'SSR' && window.confetti) {
    window.confetti({
      particleCount: 90,
      spread: 80,
      origin: { y: 0.6 }
    });
  }
}

// 환생 실행 함수 (셔플 애니메이션 포함)
function doReincarnate() {
  const buttons = document.querySelectorAll('.btn-reincarnate');
  const cardElement = document.getElementById('result-card');
  const pool = getFilteredRegions();

  if (pool.length === 0) {
    alert('해당 조건에 만족하는 지자체가 없습니다. 필터를 변경해주세요.');
    return;
  }

  buttons.forEach(btn => {
    btn.disabled = true;
    btn.classList.add('opacity-75', 'cursor-not-allowed');
  });
  cardElement.classList.add('animating-result');

  let shuffleCount = 0;
  const maxShuffles = 8;
  const interval = setInterval(() => {
    const tempRegion = pool[Math.floor(Math.random() * pool.length)];
    document.getElementById('res-province').innerText = tempRegion.province;
    document.getElementById('res-city').innerText = tempRegion.city;
    shuffleCount++;

    if (shuffleCount >= maxShuffles) {
      clearInterval(interval);
      currentRegion = selectWeightedRandomRegion(pool);
      renderResult(currentRegion, pool);

      reincarnationCount++;
      document.getElementById('reincarnation-count').innerText = reincarnationCount.toLocaleString();

      history.unshift({
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        region: currentRegion,
        mode: calculationMode === 'birth' ? '출생아' : '인구'
      });
      updateHistoryUI();

      buttons.forEach(btn => {
        btn.disabled = false;
        btn.classList.remove('opacity-75', 'cursor-not-allowed');
      });
      cardElement.classList.remove('animating-result');
    }
  }, 45);
}

// 최근 기록 갱신
function updateHistoryUI() {
  const historyList = document.getElementById('history-list');
  const historySection = document.getElementById('history-section');
  if (history.length > 0 && historyList) {
    historySection.classList.remove('hidden');
    historyList.innerHTML = history.slice(0, 6).map(h => `
      <div class="flex items-center justify-between text-xs py-2 px-3 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-300">
        <div class="flex items-center gap-2">
          <span class="text-[11px] font-bold px-2 py-0.5 rounded-md ${h.mode === '출생아' ? 'bg-pink-950 text-pink-300 border border-pink-700/50' : 'bg-indigo-950 text-indigo-300 border border-indigo-700/50'}">${h.mode}</span>
          <span class="text-white font-bold">${h.region.province} ${h.region.city}</span>
        </div>
        <span class="text-slate-500 font-mono">${h.time}</span>
      </div>
    `).join('');
  }
}

// 결과 공유 및 클립보드 복사 (Web Share API 지원)
async function shareOrCopyResult() {
  if (!currentRegion) return;
  const pool = getFilteredRegions();
  const { percentage, oneInX } = calculateChance(currentRegion, pool);
  const popShare = calculatePopulationShare(currentRegion.population);

  const modeText = calculationMode === 'birth' ? '출생아 수 기준' : '등록 인구수 기준';
  const shareTitle = `[대한민국 랜덤 다시 태어나기] ${currentRegion.province} ${currentRegion.city}`;
  const shareText = `[대한민국 랜덤 다시 태어나기 (${modeText})]\n` +
    `당신은 ${currentRegion.province} ${currentRegion.city}에서 다시 태어났습니다.\n\n` +
    `"${currentRegion.description}"\n\n` +
    `👥 인구: 약 ${(currentRegion.population / 10000).toFixed(1)}만 명 (전국의 ${popShare}%)\n` +
    `👶 출생아: 연간 약 ${currentRegion.annualBirths.toLocaleString()}명 (환생 확률: 약 ${oneInX}번 중 1번, ${percentage}%)\n` +
    currentRegion.stats.map(s => `📊 ${s.label}: ${s.value}`).join('\n') +
    `\n\n나도 다시 태어나보기: ${window.location.href}`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: window.location.href
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // 사용자가 공유창을 닫은 경우 무시
    }
  }

  // Web Share 미지원 시 클립보드 복사 폴백
  navigator.clipboard.writeText(shareText).then(() => {
    const shareBtns = document.querySelectorAll('.btn-share');
    shareBtns.forEach(btn => {
      const originalHtml = btn.innerHTML;
      btn.innerHTML = `✓ 복사 완료!`;
      btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-500');
      setTimeout(() => {
        btn.innerHTML = originalHtml;
        btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-500');
      }, 2000);
    });
  }).catch(err => {
    console.error('복사 실패:', err);
    alert('클립보드 복사에 실패했습니다.');
  });
}

// 스크롤 시 상단 고정 출생지 바 제어 (소속 자치단체, 출생지역, 희귀도만 표시)
function setupStickyHeader() {
  const stickyHeader = document.getElementById('sticky-header');
  const cityTitle = document.getElementById('res-city');
  if (!stickyHeader || !cityTitle) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      // 결과 카드의 지명이 화면 상단 밖으로 스크롤되어 지나갔을 때 표시
      if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
        stickyHeader.classList.remove('-translate-y-full', 'opacity-0', 'pointer-events-none');
        stickyHeader.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto');
      } else {
        stickyHeader.classList.add('-translate-y-full', 'opacity-0', 'pointer-events-none');
        stickyHeader.classList.remove('translate-y-0', 'opacity-100', 'pointer-events-auto');
      }
    });
  }, { threshold: 0 });

  observer.observe(cityTitle);
}

// 초기화
window.addEventListener('DOMContentLoaded', () => {
  // 1. Leaflet 실제 지도 초기화
  initRealLeafletMap();

  // 2. 상단 고정 출생지 바 스크롤 감지 초기화
  setupStickyHeader();

  // 3. 초기 환생 1회 실행
  doReincarnate();

  // 환생 & 공유 버튼 리스너 (데스크톱 및 모바일 하단 플로팅 바 동시 바인딩)
  document.querySelectorAll('.btn-reincarnate').forEach(btn => {
    btn.addEventListener('click', doReincarnate);
  });
  document.querySelectorAll('.btn-share').forEach(btn => {
    btn.addEventListener('click', shareOrCopyResult);
  });

  // 스페이스바 단축키
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      doReincarnate();
    }
  });

  // 기준 모드 선택 탭 (출생아 vs 인구)
  const modeButtons = document.querySelectorAll('.mode-btn');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => {
        b.classList.remove('bg-gradient-to-r', 'from-pink-500', 'to-rose-500', 'text-white', 'shadow-lg', 'shadow-pink-500/30', 'font-black');
        b.classList.add('text-slate-400', 'hover:text-slate-200', 'font-bold');
      });
      btn.classList.add('bg-gradient-to-r', 'from-pink-500', 'to-rose-500', 'text-white', 'shadow-lg', 'shadow-pink-500/30', 'font-black');
      btn.classList.remove('text-slate-400');
      calculationMode = btn.dataset.mode;
      
      const modeNotice = document.getElementById('mode-indicator');
      if (modeNotice) {
        modeNotice.innerText = calculationMode === 'birth' 
          ? '👶 현재 대한민국에서 새로 태어날 확률 (통계청 출생아 통계)' 
          : '👥 현재 5,130만 대한민국 국민 중 한 명이 될 확률 (주민등록 인구)';
      }
      doReincarnate();
    });
  });

  // 필터 버튼 탭
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => {
        b.classList.remove('bg-slate-800', 'text-white', 'shadow', 'font-bold', 'border', 'border-slate-600/50');
        b.classList.add('text-slate-400', 'hover:text-slate-200', 'font-semibold');
      });
      btn.classList.add('bg-slate-800', 'text-white', 'shadow', 'font-bold', 'border', 'border-slate-600/50');
      btn.classList.remove('text-slate-400');
      currentFilter = btn.dataset.filter;
      doReincarnate();
    });
  });
});
