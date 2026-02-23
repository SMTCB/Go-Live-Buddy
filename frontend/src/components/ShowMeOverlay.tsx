'use client';
import { useState } from 'react';
import { Target } from 'lucide-react';

export type FocusCoord = {
    x_pct: number;
    y_pct: number;
    w_pct: number;
    h_pct: number;
    label: string;
};

type Props = {
    imageUrl: string;
    coord: FocusCoord;
};

export default function ShowMeOverlay({ imageUrl, coord }: Props) {
    const [hovered, setHovered] = useState(false);

    return (
        <div className="relative w-full rounded-xl overflow-hidden border border-border shadow-md bg-black">
            {/* Frame image */}
            <img
                src={imageUrl}
                alt="Video frame"
                className="w-full object-contain"
                style={{ display: 'block' }}
            />

            {/* Glowing bounding box */}
            <div
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                className="absolute transition-all duration-200"
                style={{
                    left: `${coord.x_pct}%`,
                    top: `${coord.y_pct}%`,
                    width: `${coord.w_pct}%`,
                    height: `${coord.h_pct}%`,
                    border: '2.5px solid #7500C0',
                    borderRadius: '6px',
                    boxShadow: hovered
                        ? '0 0 0 3px #7500C040, 0 0 18px 6px #7500C060'
                        : '0 0 0 2px #7500C030, 0 0 10px 3px #7500C040',
                    animation: 'pulse-border 2s ease-in-out infinite',
                    cursor: 'pointer',
                    zIndex: 10,
                }}
            >
                {/* Label / Tooltip */}
                <div
                    className={`absolute -top-7 left-0 whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-bold
                      text-white transition-all duration-200 pointer-events-none
                      ${hovered ? 'opacity-100 -translate-y-0.5' : 'opacity-70'}`}
                    style={{ background: '#7500C0', boxShadow: '0 2px 8px #7500C060' }}
                >
                    🎯 {coord.label}
                </div>

                {/* Corner "click here" dot */}
                <div
                    className="absolute bottom-1 right-1 w-5 h-5 rounded-full flex items-center justify-center
                     animate-pulse"
                    style={{ background: '#7500C0' }}
                >
                    <Target size={10} className="text-white" />
                </div>
            </div>

            {/* Tooltip bar at bottom */}
            <div
                className="absolute bottom-0 left-0 right-0 px-4 py-2 text-white text-xs font-semibold
                   flex items-center gap-2 backdrop-blur-sm"
                style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}
            >
                <Target size={12} style={{ color: '#C478FF' }} />
                <span>Click here to perform the action: <em>{coord.label}</em></span>
            </div>

            {/* CSS keyframe for glowing border animation */}
            <style>{`
        @keyframes pulse-border {
          0%,100% { box-shadow: 0 0 0 2px #7500C030, 0 0 10px 3px #7500C040; }
          50%       { box-shadow: 0 0 0 3px #7500C060, 0 0 20px 8px #7500C070; }
        }
      `}</style>
        </div>
    );
}
