import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default Leaflet icon paths in Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

export default function GisMap({
  featureCollection = null,
  highlightFeature = null,
  casesBySurvey = null, // Map of survey_no -> { count, open, band }
  height = '420px',
  onSelectSurvey = null,
  showLabels = true,
}) {
  const mapContainerRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const geoJsonLayerRef = useRef(null)
  const highlightLayerRef = useRef(null)
  const highlightMarkersRef = useRef(null)
  const labelsLayerRef = useRef(null)
  const wrapperRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return

    const map = L.map(mapContainerRef.current, {
      center: [12.0628, 78.4988], // Default Dharmapuri / Harur region
      zoom: 14,
      scrollWheelZoom: true,
    })

    // 1. OpenStreetMap standard (Free, public, no API key, reliable)
    const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    })

    // 2. Esri World Imagery (Satellite - Free, no API key, high quality)
    const satTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 18,
    })

    // 3. Esri World Topographic (Clean contours and landmarks - Free, no API key)
    const topoTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19,
    })

    // 4. Esri Light Gray Canvas (Clean, neutral cadastre background - Free, no API key)
    const grayTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 16,
    })

    // Default to OpenStreetMap
    osmTiles.addTo(map)

    const baseMaps = {
      'OpenStreetMap': osmTiles,
      'Satellite': satTiles,
      'Topographic': topoTiles,
      'Light Gray': grayTiles,
    }

    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)

    labelsLayerRef.current = L.layerGroup().addTo(map)
    highlightMarkersRef.current = L.layerGroup().addTo(map)
    mapInstanceRef.current = map

    return () => {
      map.remove()
      mapInstanceRef.current = null
    }
  }, [])

  // Invalidate map size when fullscreen changes
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const timer = setTimeout(() => {
      map.invalidateSize()
    }, 150)
    return () => clearTimeout(timer)
  }, [isFullscreen])

  // Native Fullscreen API state listeners
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = Boolean(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      )
      setIsFullscreen(isFs)
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize()
        }
      }, 150)
    }

    document.addEventListener('fullscreenchange', handleFsChange)
    document.addEventListener('webkitfullscreenchange', handleFsChange)
    document.addEventListener('mozfullscreenchange', handleFsChange)
    document.addEventListener('MSFullscreenChange', handleFsChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
      document.removeEventListener('webkitfullscreenchange', handleFsChange)
      document.removeEventListener('mozfullscreenchange', handleFsChange)
      document.removeEventListener('MSFullscreenChange', handleFsChange)
    }
  }, [])

  // Update FeatureCollection and styles
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    // Clean up previous layers
    if (geoJsonLayerRef.current) {
      map.removeLayer(geoJsonLayerRef.current)
      geoJsonLayerRef.current = null
    }
    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current)
      highlightLayerRef.current = null
    }
    if (labelsLayerRef.current) {
      labelsLayerRef.current.clearLayers()
    }
    if (highlightMarkersRef.current) {
      highlightMarkersRef.current.clearLayers()
    }

    // Normalize highlight features (can be single Feature, Array of Features, or FeatureCollection)
    const highlightList = []
    if (Array.isArray(highlightFeature)) {
      highlightList.push(...highlightFeature.filter(Boolean))
    } else if (highlightFeature?.type === 'FeatureCollection') {
      highlightList.push(...(highlightFeature.features || []))
    } else if (highlightFeature?.type === 'Feature') {
      highlightList.push(highlightFeature)
    }

    const highlightedSurveyNos = new Set(
      highlightList.map((f) => String(f.properties?.survey_no || '').trim().toLowerCase())
    )

    let bounds = null

    // Determine color based on litigation intensity
    const getParcelStyle = (feature) => {
      const sNo = String(feature?.properties?.survey_no || '').trim()
      const dispute = casesBySurvey ? casesBySurvey[sNo] : null

      let fillColor = '#0d9488' // Default calm teal
      let fillOpacity = 0.25
      let weight = 1.2
      let color = '#0f766e'

      if (dispute) {
        const count = dispute.total || dispute.count || 0
        if (count >= 3 || dispute.band === 'High') {
          fillColor = '#dc2626' // Red
          fillOpacity = 0.55
          color = '#991b1b'
          weight = 2
        } else if (count >= 1 || dispute.band === 'Medium') {
          fillColor = '#ea580c' // Orange
          fillOpacity = 0.45
          color = '#c2410c'
          weight = 1.8
        }
      }

      return {
        fillColor,
        weight,
        opacity: 0.9,
        color,
        fillOpacity,
      }
    }

    // Render Background Village FeatureCollection
    if (featureCollection && featureCollection.features?.length) {
      const geoLayer = L.geoJSON(featureCollection, {
        style: getParcelStyle,
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {}
          const sNo = String(props.survey_no || '')
          const dispute = casesBySurvey ? casesBySurvey[sNo] : null
          const areaM2 = props.area_sqm ? Number(props.area_sqm).toLocaleString('en-IN') : '—'
          const areaHa = props.area_sqm ? (Number(props.area_sqm) / 10000).toFixed(3) : '—'

          let popupHtml = `
            <div style="font-family: inherit; font-size: 13px; line-height: 1.5; min-width: 170px;">
              <div style="font-weight: 700; font-size: 14px; color: #0f172a; border-bottom: 2px solid #0d9488; padding-bottom: 4px; margin-bottom: 6px;">
                Survey Parcel No. ${sNo}
              </div>
              <div><b>Boundary Area:</b> ${areaM2} m² (${areaHa} Ha)</div>
              ${props.subdivision ? `<div><b>Subdivision:</b> ${props.subdivision}</div>` : ''}
              ${props.patta_no ? `<div><b>Patta No:</b> ${props.patta_no}</div>` : ''}
              ${props.owner ? `<div><b>Registered Owner:</b> ${props.owner}</div>` : ''}
              <div style="margin-top: 6px; padding: 3px 6px; border-radius: 4px; font-size: 11.5px; font-weight: 600; text-align: center; background: ${dispute ? '#fee2e2; color: #991b1b;' : '#f0fdfa; color: #0f766e;'}">
                ${dispute ? `Disputed: ${dispute.total || dispute.count || 0} Case(s)` : 'Clear Boundary · No Active Disputes'}
              </div>
            </div>
          `
          layer.bindPopup(popupHtml)

          layer.on({
            mouseover: (e) => {
              const l = e.target
              l.setStyle({ weight: 2.5, opacity: 1, fillOpacity: 0.65 })
            },
            mouseout: (e) => {
              geoLayer.resetStyle(e.target)
            },
            click: () => {
              if (onSelectSurvey && sNo) onSelectSurvey(sNo)
            },
          })

          // Add centroid text label for background parcels (skip if this parcel is in highlightList)
          if (showLabels && props.centroid_lat && props.centroid_lng && !highlightedSurveyNos.has(sNo.toLowerCase())) {
            L.marker([props.centroid_lat, props.centroid_lng], {
              interactive: false,
              icon: L.divIcon({
                className: 'gis-survey-label',
                html: `<span style="background: rgba(255,255,255,0.92); border: 1px solid #94a3b8; color: #0f172a; padding: 1px 5px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap !important; pointer-events: none; box-shadow: 0 1px 3px rgba(0,0,0,0.12);">${sNo}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
            }).addTo(labelsLayerRef.current)
          }
        },
      })

      geoLayer.addTo(map)
      geoJsonLayerRef.current = geoLayer

      // Only fit to full village bounds if there are no highlight features
      if (highlightList.length === 0) {
        bounds = geoLayer.getBounds()
      }
    }

    // Render Highlighted Feature(s) — e.g. from Citizen Survey or Patta Search (supports multiple linked surveys)
    if (highlightList.length > 0) {
      const hLayerGroup = L.featureGroup()
      const highlightBounds = L.latLngBounds([])

      highlightList.forEach((feat, idx) => {
        const hLayer = L.geoJSON(feat, {
          style: {
            fillColor: '#2563eb',
            weight: 3.5,
            color: '#1d4ed8',
            fillOpacity: 0.52,
          },
          onEachFeature: (feature, layer) => {
            const props = feature.properties || {}
            const sNo = props.survey_no || 'Selected'
            const areaM2 = props.area_sqm ? Number(props.area_sqm).toLocaleString('en-IN') : '—'
            const areaHa = props.area_sqm ? (Number(props.area_sqm) / 10000).toFixed(3) : '—'
            const areaAcre = props.area_sqm ? (Number(props.area_sqm) * 0.000247105).toFixed(3) : '—'

            layer.bindPopup(`
              <div style="font-family: inherit; font-size: 13px; line-height: 1.5; min-width: 190px;">
                <div style="font-weight: 700; font-size: 14px; color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 4px; margin-bottom: 6px;">
                  Survey Parcel No. ${sNo}
                </div>
                <div><b>Village:</b> ${props.village || 'N/A'}</div>
                <div><b>Boundary Area:</b> ${areaM2} m²</div>
                <div><b>Calculated Extent:</b> ${areaHa} Ha (${areaAcre} Acres)</div>
                ${props.subdivision ? `<div><b>Subdivision:</b> ${props.subdivision}</div>` : ''}
                ${props.patta_no ? `<div><b>Patta:</b> ${props.patta_no}</div>` : ''}
                <div style="margin-top: 6px; padding: 4px 8px; background: #dbeafe; color: #1e40af; border-radius: 4px; font-size: 11.5px; font-weight: 600; text-align: center;">
                  ${highlightList.length > 1 ? `Linked Survey (${idx + 1} of ${highlightList.length})` : 'Active Search Target'}
                </div>
              </div>
            `)

            if (idx === 0) layer.openPopup()

            // Clean, non-wrapping badge for the highlighted survey parcel
            if (props.centroid_lat && props.centroid_lng) {
              L.marker([props.centroid_lat, props.centroid_lng], {
                interactive: false,
                icon: L.divIcon({
                  className: 'gis-active-survey-pill',
                  html: `<div style="
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    background: #1e40af;
                    color: #ffffff;
                    border: 2px solid #ffffff;
                    font-family: inherit;
                    font-weight: 700;
                    font-size: 12px;
                    line-height: 1;
                    padding: 4px 10px;
                    border-radius: 20px;
                    box-shadow: 0 3px 10px rgba(0,0,0,0.35);
                    white-space: nowrap !important;
                    word-break: keep-all !important;
                    pointer-events: none;
                    transform: translate(-50%, -50%);
                  ">
                    <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#60a5fa; flex-shrink:0;"></span>
                    <span>Survey ${sNo}</span>
                  </div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                }),
              }).addTo(highlightMarkersRef.current)
            }
          },
        })

        hLayer.addTo(hLayerGroup)
        const b = hLayer.getBounds()
        if (b.isValid()) {
          highlightBounds.extend(b)
        }
      })

      hLayerGroup.addTo(map)
      highlightLayerRef.current = hLayerGroup

      if (highlightBounds.isValid()) {
        bounds = highlightBounds
      }
    }

    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 })
    }
  }, [featureCollection, highlightFeature, casesBySurvey, showLabels])

  // Native Fullscreen API Toggle (takes over the whole operating system screen)
  const toggleFullscreen = useCallback(async () => {
    const wrapper = wrapperRef.current
    if (!wrapper) return

    const isCurrentlyFs = Boolean(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    )

    if (!isCurrentlyFs) {
      try {
        if (wrapper.requestFullscreen) {
          await wrapper.requestFullscreen()
        } else if (wrapper.webkitRequestFullscreen) {
          await wrapper.webkitRequestFullscreen()
        } else if (wrapper.mozRequestFullScreen) {
          await wrapper.mozRequestFullScreen()
        } else if (wrapper.msRequestFullscreen) {
          await wrapper.msRequestFullscreen()
        }
      } catch (err) {
        console.warn('Native fullscreen request failed, falling back to CSS fullscreen:', err)
        setIsFullscreen((prev) => !prev)
      }
    } else {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen()
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen()
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen()
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen()
        }
      } catch (err) {
        console.warn('Exit fullscreen error:', err)
        setIsFullscreen(false)
      }
    }
  }, [])

  return (
    <div
      ref={wrapperRef}
      className={`gis-map-wrapper ${isFullscreen ? 'is-css-fullscreen' : ''}`}
      style={{
        height: isFullscreen ? '100vh' : height,
      }}
    >
      <div
        ref={mapContainerRef}
        className="gis-map-canvas"
        style={{ width: '100%', height: '100%' }}
      />

      {/* Fullscreen toggle button */}
      <button
        type="button"
        onClick={toggleFullscreen}
        title={isFullscreen ? 'Exit fullscreen (Esc)' : 'View in full screen'}
        style={{
          position: 'absolute',
          bottom: isFullscreen ? '20px' : '10px',
          right: isFullscreen ? '20px' : '10px',
          zIndex: 1000,
          background: 'rgba(255,255,255,0.95)',
          border: '1px solid rgba(0,0,0,0.2)',
          borderRadius: '6px',
          width: '34px',
          height: '34px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          fontSize: '16px',
          fontWeight: 700,
          lineHeight: 1,
          color: '#0f172a',
          transition: 'all 0.15s ease',
          padding: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#ffffff'
          e.currentTarget.style.transform = 'scale(1.05)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255,255,255,0.95)'
          e.currentTarget.style.transform = 'scale(1)'
        }}
      >
        {isFullscreen ? '✕' : '⛶'}
      </button>

      {/* Fullscreen indicator badge */}
      {isFullscreen && (
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: 'rgba(15,23,42,0.85)',
            backdropFilter: 'blur(4px)',
            color: '#ffffff',
            fontSize: '12.5px',
            padding: '5px 16px',
            borderRadius: '24px',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          Whole Screen Mode · Press <b>Esc</b> or click <b>✕</b> to exit
        </div>
      )}
    </div>
  )
}
