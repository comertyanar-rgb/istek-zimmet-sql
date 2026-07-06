import {
  ChevronDown,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  Users, // <-- Yeni eklendi
  X,
} from 'lucide-react';

export const GlpiMissingTab = ({
  missingGlpiSearchQuery,
  setMissingGlpiSearchQuery,
  showMissingGlpiFilters,
  setShowMissingGlpiFilters,
  fetchMissingGlpiDevices,
  isLoadingMissingGlpi,
  activeMissingGlpiFilterDropdown,
  setActiveMissingGlpiFilterDropdown,
  missingGlpiFilterType,
  setMissingGlpiFilterType,
  missingGlpiFilterCampus,
  setMissingGlpiFilterCampus,
  missingGlpiTypeOptions,
  missingGlpiCampusOptions,
  isHQ,
  isGlpiSelectionMode,
  displayMissingGlpiDevices,
  selectedMissingGlpiIds,
  setSelectedMissingGlpiIds,
  handleGlpiToggleBulk,
  handleGlpiTouchStart,
  handleGlpiTouchEnd,
  renderDeviceTypeIcon,
  setViewingPersonId,
}) => {
  const formatCampusLabel = (value) => {
    const raw = value === null || value === undefined ? '' : String(value).trim();
    if (!raw || raw === '-' || raw === '0' || /^\d+$/.test(raw)) return '-';
    return raw.replace(/Kampüsü|Kampusu|Kampüs|Kampus/gi, '').trim() || '-';
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  };

  const allVisibleSelected =
    displayMissingGlpiDevices.length > 0 &&
    displayMissingGlpiDevices.every((item) => selectedMissingGlpiIds.includes(item.glpiId));

  const selectAllVisible = (checked) => {
    if (checked) {
      setSelectedMissingGlpiIds(
        Array.from(
          new Set([
            ...selectedMissingGlpiIds,
            ...displayMissingGlpiDevices.map((item) => item.glpiId),
          ])
        )
      );
    } else {
      const visibleIds = new Set(displayMissingGlpiDevices.map((item) => item.glpiId));
      setSelectedMissingGlpiIds((prev) => prev.filter((id) => !visibleIds.has(id)));
    }
  };

  const clearFilters = () => {
    setMissingGlpiFilterType('All');
    setMissingGlpiFilterCampus('All');
    setActiveMissingGlpiFilterDropdown(null);
  };

  return (
    <div className="space-y-0 animate-in fade-in relative">
      <div
        style={{ position: 'sticky', top: 0, zIndex: 80 }}
        className="bg-slate-50/95 backdrop-blur-sm -mx-3 px-2 py-2 md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-none mb-1"
      >
        <div className="flex items-center gap-2 w-full">
          <div className="flex items-center flex-1 min-w-0 px-3 h-10 border border-gray-200 rounded-xl bg-white shadow-sm focus-within:border-[#0066b1] focus-within:ring-2 focus-within:ring-[#0066b1]/20 transition-all">
            <input
              type="text"
              placeholder="GLPI cihaz adı, seri no, AD kullanıcı ara..."
              className="flex-1 bg-transparent outline-none min-w-0 text-gray-800 text-sm h-full"
              value={missingGlpiSearchQuery}
              onChange={(e) => setMissingGlpiSearchQuery(e.target.value)}
            />
            <div className="flex items-center gap-2 ml-2 shrink-0">
              {missingGlpiSearchQuery && (
                <button
                  onClick={() => setMissingGlpiSearchQuery('')}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <Search className="w-4 h-4 text-gray-400" />
            </div>
          </div>

          <button
            onClick={() => setShowMissingGlpiFilters(!showMissingGlpiFilters)}
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 transition-colors shadow-sm md:hidden ${
              showMissingGlpiFilters
                ? 'bg-blue-50 border-blue-300 text-[#0066b1]'
                : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}
          >
            <Filter className="w-4 h-4" />
          </button>

          <button
            onClick={() => fetchMissingGlpiDevices(true)}
            disabled={isLoadingMissingGlpi}
            className="h-10 px-3 md:px-4 rounded-xl border border-gray-200 bg-white text-[#0066b1] hover:bg-blue-50 font-bold flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 transition-colors"
            title="GLPI Listesini Yenile"
          >
            <RefreshCw className={`w-4 h-4 ${isLoadingMissingGlpi ? 'animate-spin' : ''}`} />
            <span className="hidden md:inline text-sm">Yenile</span>
          </button>
        </div>

        <div
          className={`relative mt-3 mb-0 z-[90] ${
            showMissingGlpiFilters
              ? 'block animate-in slide-in-from-top-1 fade-in duration-200'
              : 'hidden md:block'
          }`}
        >
          <style>{`.hide-scroll-bar::-webkit-scrollbar { display: none; } .hide-scroll-bar { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
          <div className="flex items-center gap-2 pb-1 overflow-x-auto hide-scroll-bar w-full">
            <button
              onClick={() =>
                setActiveMissingGlpiFilterDropdown(
                  activeMissingGlpiFilterDropdown === 'type' ? null : 'type'
                )
              }
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm shrink-0 ${
                missingGlpiFilterType !== 'All'
                  ? 'bg-[#0066b1] border-[#0066b1] text-white'
                  : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Tip: {missingGlpiFilterType === 'All' ? 'Tümü' : missingGlpiFilterType}
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {isHQ && (
              <button
                onClick={() =>
                  setActiveMissingGlpiFilterDropdown(
                    activeMissingGlpiFilterDropdown === 'campus' ? null : 'campus'
                  )
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] sm:text-xs font-bold border transition-colors shadow-sm shrink-0 ${
                  missingGlpiFilterCampus !== 'All'
                    ? 'bg-[#0066b1] border-[#0066b1] text-white'
                    : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                Kampüs:{' '}
                {missingGlpiFilterCampus === 'All'
                  ? 'Tümü'
                  : missingGlpiFilterCampus.length > 14
                    ? missingGlpiFilterCampus.substring(0, 14) + '...'
                    : missingGlpiFilterCampus}
                <ChevronDown className="w-3 h-3 opacity-70" />
              </button>
            )}

            {(missingGlpiFilterType !== 'All' || missingGlpiFilterCampus !== 'All') && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-[11px] font-bold text-red-500 hover:text-red-700 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-full transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" /> Temizle
              </button>
            )}
          </div>

          {activeMissingGlpiFilterDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 70, paddingTop: '4px' }}>
              <div
                className="fixed inset-0"
                style={{ zIndex: 60 }}
                onClick={() => setActiveMissingGlpiFilterDropdown(null)}
              />
              {activeMissingGlpiFilterDropdown === 'type' && (
                <div style={{ width: '220px', position: 'relative', zIndex: 70 }} className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto">
                  {missingGlpiTypeOptions.map((typeOption) => (
                    <button
                      key={typeOption}
                      onClick={() => {
                        setMissingGlpiFilterType(typeOption);
                        setActiveMissingGlpiFilterDropdown(null);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        missingGlpiFilterType === typeOption
                          ? 'font-bold text-[#0066b1] bg-blue-50/50'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {typeOption === 'All' ? 'Tümü' : typeOption}
                    </button>
                  ))}
                </div>
              )}
              {activeMissingGlpiFilterDropdown === 'campus' && isHQ && (
                <div style={{ width: '260px', position: 'relative', zIndex: 70 }} className="bg-white border border-gray-200 rounded-xl shadow-2xl py-1.5 max-h-[50vh] overflow-y-auto sm:ml-[96px]">
                  {missingGlpiCampusOptions.map((campusOption) => (
                    <button
                      key={campusOption}
                      onClick={() => {
                        setMissingGlpiFilterCampus(campusOption);
                        setActiveMissingGlpiFilterDropdown(null);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        missingGlpiFilterCampus === campusOption
                          ? 'font-bold text-[#0066b1] bg-blue-50/50'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {campusOption === 'All' ? 'Tüm Kampüsler' : campusOption}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isGlpiSelectionMode && displayMissingGlpiDevices.length > 0 && (
        <label className="flex items-center gap-3 bg-blue-50/80 p-3 rounded-xl shadow-sm border border-blue-200 cursor-pointer mt-2 animate-in fade-in transition-colors hover:bg-blue-100/50">
          <input
            type="checkbox"
            className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#0066b1]"
            checked={allVisibleSelected}
            onChange={(e) => selectAllVisible(e.target.checked)}
          />
          <span className="text-sm font-bold text-[#0066b1]">
            Filtrelenen tüm GLPI cihazlarını seç ({displayMissingGlpiDevices.length})
          </span>
        </label>
      )}

      {isLoadingMissingGlpi ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 mt-2 flex flex-col items-center justify-center text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin text-[#0066b1] mb-3" />
          <p className="font-bold">GLPI eksikleri alınıyor...</p>
        </div>
      ) : (
        <>
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-x-auto mt-2">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="p-4 w-12 text-center">
                    <input
                      type="checkbox"
                      className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500"
                      checked={allVisibleSelected}
                      onChange={(e) => selectAllVisible(e.target.checked)}
                    />
                  </th>
                  <th className="p-4 font-semibold text-gray-600">Cihaz</th>
                  <th className="p-4 font-semibold text-gray-600">Seri No</th>
                  <th className="p-4 font-semibold text-gray-600">GLPI Kullanıcı</th>
                  <th className="p-4 font-semibold text-gray-600">Kampüs / Tip</th>
                  <th className="p-4 font-semibold text-gray-600">Son Sync</th>
                </tr>
              </thead>
              <tbody>
                {displayMissingGlpiDevices.map((item) => {
                  const selected = selectedMissingGlpiIds.includes(item.glpiId);
                  return (
                    <tr
                      key={item.glpiId}
                      onClick={() => handleGlpiToggleBulk(item.glpiId)}
                      className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${selected ? 'bg-blue-50/60' : ''}`}
                    >
                      <td className="p-4 text-center">
                        <input type="checkbox" className="w-4 h-4 cursor-pointer text-blue-600 rounded focus:ring-blue-500" checked={selected} readOnly />
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {renderDeviceTypeIcon(item.deviceType, 'w-4 h-4 text-[#0066b1]')}
                          <div className="min-w-0">
                            <p className="font-bold text-gray-900 truncate">{item.computerName || '-'}</p>
                            <p className="text-xs text-gray-500 truncate">{[item.brand, item.model].filter(Boolean).join(' ') || 'GLPI cihazı'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4 font-semibold text-[#0066b1]">{item.serial || '-'}</td>
                      <td className="p-4">
                        {item.matchedPersonId ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setViewingPersonId(item.matchedPersonId);
                            }}
                            className="font-semibold text-[#0066b1] hover:underline text-left"
                            title="Personel profilini aç"
                          >
                            {item.matchedPersonName || item.adUser || '-'}
                          </button>
                        ) : (
                          <p className="font-semibold text-gray-800">{item.matchedPersonName || item.adUser || '-'}</p>
                        )}
                        {item.matchedPersonName && item.adUser && <p className="text-xs text-gray-500">{item.adUser}</p>}
                      </td>
                      <td className="p-4">
                        <p className="font-semibold text-gray-800">{formatCampusLabel(item.inferredCampus)}</p>
                        <p className="text-xs text-gray-500">{item.deviceType || 'Tip bulunamadı'}</p>
                      </td>
                      <td className="p-4 text-sm text-gray-500">{formatDateTime(item.lastSync)}</td>
                    </tr>
                  );
                })}
                {displayMissingGlpiDevices.length === 0 && (
                  <tr>
                    <td colSpan="6" className="p-8 text-center text-gray-500">
                      Kriterlere uygun eksik GLPI cihazı bulunamadı.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* MOBİL CARDS */}
          <div className="block md:hidden space-y-2 mt-2 pb-32">
            {displayMissingGlpiDevices.map((item) => {
              const selected = selectedMissingGlpiIds.includes(item.glpiId);
              return (
                <div
                  key={item.glpiId}
                  onClick={() => {
                    if (isGlpiSelectionMode) handleGlpiToggleBulk(item.glpiId);
                  }}
                  onTouchStart={() => handleGlpiTouchStart(item.glpiId)}
                  onTouchEnd={handleGlpiTouchEnd}
                  onTouchMove={handleGlpiTouchEnd}
                  onMouseDown={() => handleGlpiTouchStart(item.glpiId)}
                  onMouseUp={handleGlpiTouchEnd}
                  onMouseLeave={handleGlpiTouchEnd}
                  className={`bg-white rounded-xl shadow-sm border p-4 flex flex-col transition-colors relative select-none cursor-pointer ${
                    isGlpiSelectionMode && selected
                      ? 'border-[#0066b1] bg-[#e0f0ff] ring-1 ring-[#0066b1]/50'
                      : 'border-gray-200 active:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-3 w-full">
                    {/* CHECKBOX */}
                    {isGlpiSelectionMode && (
                      <div className="pt-2 shrink-0 z-10 animate-in zoom-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                        <input 
                          type="checkbox" 
                          className="w-5 h-5 cursor-pointer text-[#0066b1] rounded border-gray-300 focus:ring-[#8bcdc5]" 
                          checked={selected} 
                          onChange={() => handleGlpiToggleBulk(item.glpiId)} 
                        />
                      </div>
                    )}
                    
                    {/* CİHAZ İKONU */}
                    <div className={`w-10 h-10 mt-0.5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${isGlpiSelectionMode && selected ? 'bg-white border-[#8bcdc5]' : 'bg-slate-50 border-slate-200'}`}>
                      {renderDeviceTypeIcon(item.deviceType, 'w-5 h-5 text-[#0066b1]')}
                    </div>
                    
                    <div className="flex-1 min-w-0 mt-0">
                      {/* ÜST SATIR: Bilgisayar İsmi ve Kampüs Rozeti */}
                      <div className="flex justify-between items-start gap-2">
                        <p className="font-black text-gray-900 text-[15px] leading-tight truncate pr-2">
                          {item.computerName || '-'}
                        </p>
                        {/* KAMPÜS ROZETİ (Personel sekmesindeki gibi sağ üstte) */}
                        {formatCampusLabel(item.inferredCampus) !== '-' && (
                          <span className="shrink-0 text-[9px] bg-gray-100 text-gray-500 px-2 py-1 rounded-md font-bold uppercase tracking-wider border border-gray-200">
                            {formatCampusLabel(item.inferredCampus)}
                          </span>
                        )}
                      </div>
                      
                      {/* Marka / Model */}
                      <p className="text-xs text-gray-500 font-semibold truncate mt-0.5">
                        {[item.brand, item.model].filter(Boolean).join(' ') || 'GLPI cihazı'}
                      </p>
                      
                      {/* S/N ve Tip */}
                      <p className="text-xs font-bold text-[#0066b1] mt-1 flex items-center gap-1.5 truncate">
                        <span>S/N: {item.serial || '-'}</span>
                        <span className="text-gray-300">|</span>
                        <span className="text-[10px] text-gray-500 font-medium">{item.deviceType || 'Tip Yok'}</span>
                      </p>
                    </div>
                  </div>

                  {/* ALT SATIR: AD Kullanıcı (Donanım sekmesindeki gibi boydan boya kutu) */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mt-3 flex flex-col w-full">
                    <p className="text-[10px] font-bold text-slate-400 tracking-wider mb-2">
                      GLPI AD KULLANICI:
                    </p>
                    <div className="flex flex-wrap justify-start gap-2 flex-1">
                      {item.matchedPersonId ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isGlpiSelectionMode) setViewingPersonId(item.matchedPersonId);
                          }}
                          className={`px-2.5 py-1.5 bg-white rounded-md flex items-center gap-1.5 border border-slate-200 shadow-sm text-xs font-bold transition-colors ${
                            isGlpiSelectionMode
                              ? 'text-gray-400 pointer-events-none'
                              : 'text-slate-700 hover:bg-blue-50 hover:text-[#0066b1] hover:border-blue-200'
                          }`}
                        >
                          <Users className="w-3.5 h-3.5 opacity-60" />
                          <span className="truncate text-left">{item.matchedPersonName || item.adUser || '-'}</span>
                        </button>
                      ) : (
                        <div className="px-2.5 py-1.5 bg-gray-100 rounded-md border border-gray-200 text-xs font-bold text-gray-500 flex items-center gap-1.5 w-max">
                           <Users className="w-3.5 h-3.5 opacity-40" />
                           <span className="truncate">{item.matchedPersonName || item.adUser || '-'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            
            {displayMissingGlpiDevices.length === 0 && (
              <div className="text-center p-6 text-gray-500 border border-dashed rounded-xl bg-white">
                GLPI listesinde cihaz bulunamadı.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
