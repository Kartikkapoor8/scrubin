// ScrubIn hologram shader. Additive, unlit, emissive: on a HoloLens black is invisible and light only adds.
// One shader for every hologram in the project (lines, tubes, dots, rings, meshes). Use it through
// HoloMaterials; the knobs are documented in CLAUDE.md.
//
// Stereo: carries the instancing macros, so it renders in both eyes under Single Pass Instanced.
Shader "ScrubIn/HoloGlow"
{
    Properties
    {
        _Color ("Color", Color) = (0.247, 0.878, 1, 1)
        _Intensity ("Intensity", Float) = 1
        _Alpha ("Alpha (fade)", Range(0, 1)) = 1

        [Header(Surface)]
        _Fill ("Fill (flat brightness)", Range(0, 1)) = 1
        _RimStrength ("Rim Strength (fresnel)", Float) = 0
        _RimPower ("Rim Power", Float) = 2.5

        [Header(Shape from UVs)]
        _Shape ("Shape: 0 solid, 1 line, 2 disc, 3 ring", Float) = 0
        _Soft ("Edge Softness", Float) = 2

        [Header(Pulse)]
        _PulseSpeed ("Pulse Speed (Hz)", Float) = 0
        _PulseAmount ("Pulse Amount", Range(0, 1)) = 0
        _PulsePhase ("Pulse Phase (cycles)", Float) = 0

        [Header(Along the length U)]
        _Draw ("Draw Progress", Range(0, 1)) = 1
        _DrawHead ("Draw Head Glow", Float) = 2
        _Dash ("Dash Count (0 = solid)", Float) = 0
        _FlowSpeed ("Flow Speed (cycles per second)", Float) = 0
        _FlowCount ("Flow Band Count", Float) = 4
        _FlowStrength ("Flow Strength", Float) = 0

        [Header(Reveal wipe in patient space)]
        _RevealOn ("Reveal On (0 or 1)", Float) = 0
        _RevealAxis ("Reveal Axis", Vector) = (1, 0, 0, 0)
        _RevealPos ("Reveal Position (m)", Float) = 0
        _RevealBand ("Reveal Glow Band (m)", Float) = 0.012
        _RevealGlow ("Reveal Glow", Float) = 3

        [Enum(UnityEngine.Rendering.CullMode)] _Cull ("Cull", Float) = 0
        [Enum(UnityEngine.Rendering.CompareFunction)] _ZTest ("ZTest", Float) = 4
    }

    SubShader
    {
        Tags { "Queue" = "Transparent" "RenderType" = "Transparent" "IgnoreProjector" = "True" }

        Pass
        {
            Blend One One
            ZWrite Off
            ZTest [_ZTest]
            Cull [_Cull]

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 viewWS : TEXCOORD2;
                float3 patientPos : TEXCOORD3;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            fixed4 _Color;
            float _Intensity;
            float _Alpha;
            float _Fill;
            float _RimStrength;
            float _RimPower;
            float _Shape;
            float _Soft;
            float _PulseSpeed;
            float _PulseAmount;
            float _PulsePhase;
            float _Draw;
            float _DrawHead;
            float _Dash;
            float _FlowSpeed;
            float _FlowCount;
            float _FlowStrength;
            float _RevealOn;
            float4 _RevealAxis;
            float _RevealPos;
            float _RevealBand;
            float _RevealGlow;

            // Globals set from script. _ScrubInGlobalDim is "1 - fade" so that never setting it means visible.
            float4x4 _ScrubInWorldToPatient;
            float _ScrubInGlobalDim;

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_OUTPUT(v2f, o);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                float4 worldPos = mul(unity_ObjectToWorld, float4(v.vertex.xyz, 1.0));
                o.pos = UnityObjectToClipPos(v.vertex);
                o.color = v.color;
                o.uv = v.uv;
                // World normal, left un-normalized on purpose: line and quad meshes have no normals, and
                // normalizing a zero vector here would feed NaNs to the fragment stage.
                o.normalWS = mul(v.normal, (float3x3)unity_WorldToObject);
                o.viewWS = _WorldSpaceCameraPos.xyz - worldPos.xyz;
                o.patientPos = mul(_ScrubInWorldToPatient, float4(worldPos.xyz, 1.0)).xyz;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                float3 col = _Color.rgb * i.color.rgb * _Intensity;
                float a = saturate(_Alpha) * i.color.a * saturate(1.0 - _ScrubInGlobalDim);

                // Shape profile from UVs: soft-edged lines, discs and rings instead of hard geometry edges.
                float prof = 1.0;
                if (_Shape > 0.5)
                {
                    if (_Shape < 1.5)
                    {
                        // Line: V runs across the width. Bright core plus a soft halo.
                        float t = saturate(1.0 - abs(i.uv.y * 2.0 - 1.0));
                        prof = saturate(smoothstep(0.45, 0.8, t) + 0.5 * pow(t, max(_Soft, 0.01)));
                    }
                    else
                    {
                        float r = length(i.uv * 2.0 - 1.0);
                        if (_Shape < 2.5)
                        {
                            // Disc: bright centre, soft edge.
                            float t = saturate(1.0 - r);
                            prof = saturate(smoothstep(0.35, 0.7, t) + 0.5 * pow(t, max(_Soft, 0.01)));
                        }
                        else
                        {
                            // Ring: a thin circle at 80% of the quad's radius.
                            float t = saturate(1.0 - abs(r - 0.8) / 0.2);
                            prof = saturate(smoothstep(0.35, 0.8, t) + 0.5 * pow(t, max(_Soft, 0.01)));
                        }
                    }
                }

                // Fresnel rim for solids: glowing edges, see-through middle.
                float shade = _Fill;
                if (_RimStrength > 0.0001)
                {
                    float3 n = i.normalWS / max(length(i.normalWS), 1e-5);
                    float3 v = i.viewWS / max(length(i.viewWS), 1e-5);
                    float rim = pow(saturate(1.0 - abs(dot(n, v))), max(_RimPower, 0.01));
                    shade += _RimStrength * rim;
                }

                // Pulse: brightness dips by _PulseAmount, _PulseSpeed times a second.
                float pulse = 1.0 - _PulseAmount * (0.5 - 0.5 * sin((_Time.y * _PulseSpeed + _PulsePhase) * 6.2831853));

                // Effects along the length (U): trace-on, dashes, travelling flow bands.
                float u = i.uv.x;
                float along = 1.0;
                if (_Draw < 0.9999)
                {
                    float behind = _Draw - u;                       // > 0 where the line is already drawn
                    along = step(0.0, behind) * step(0.0001, _Draw);
                    float head = saturate(1.0 - behind / 0.08) * saturate((1.0 - _Draw) * 12.0);
                    along *= 1.0 + _DrawHead * head * head;
                }
                if (_Dash > 0.5)
                {
                    along *= step(frac(u * _Dash), 0.55);
                }
                if (_FlowStrength > 0.0001)
                {
                    float f = frac(u * _FlowCount - _Time.y * _FlowSpeed);
                    float band = saturate(1.0 - abs(f * 2.0 - 1.0));
                    along *= 1.0 + _FlowStrength * band * band * band;
                }

                // Reveal wipe: everything with (patientPos . axis) below _RevealPos is shown, with a bright
                // band just behind the moving front.
                if (_RevealOn > 0.5)
                {
                    float d = dot(i.patientPos, _RevealAxis.xyz) - _RevealPos;   // < 0 = revealed
                    float edge = saturate(1.0 + d / max(_RevealBand, 1e-4));
                    a *= step(d, 0.0);
                    col *= 1.0 + _RevealGlow * edge * edge;
                }

                float3 rgb = col * (prof * shade * pulse * along * a);
                // Alpha carries brightness so capture tools that composite by alpha still see the hologram.
                return fixed4(rgb, saturate(max(rgb.r, max(rgb.g, rgb.b))));
            }
            ENDCG
        }
    }

    Fallback Off
}
