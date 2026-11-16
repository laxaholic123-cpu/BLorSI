/**
 * The bottom sheets and cards of the board review screen.
 *
 * Lifted out of `app/catan-board-scan.tsx`, which had grown to 1,800 lines. Each
 * of these draws what it is given and reports taps; none of them owns any of
 * the board's state.
 */

import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useColors } from '@/hooks/useColors';
import { PORT_TYPE_ORDER } from '@/services/catanPorts';
import { CATAN_NUMBERS } from '@/services/catanStats';
import type { CatanBoardLayout, CatanPortDef, PortType, ResourceType } from '@/types/models';

import { s } from './styles';

export const RESOURCES: ResourceType[] = ['grain', 'ore', 'lumber', 'brick', 'wool', 'desert'];

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  grain: 'Grain', ore: 'Ore', lumber: 'Lumber', brick: 'Brick', wool: 'Wool', desert: 'Desert', any: 'Any',
};

export const RESOURCE_COLORS: Record<ResourceType, string> = {
  grain: '#E8B840', ore: '#8A8A8A', lumber: '#2E5E10', brick: '#C03820',
  wool: '#58B030', desert: '#C8A050', any: '#4A6080',
};

function formatSavedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Set what a harbour trades.
 *
 * The caller applies the pick through `setPortType`, which SWAPS rather than
 * assigns: the box holds four generic harbours and one of each resource, so
 * naming this one "ore" has to take ore away from whichever harbour had it.
 */
export function PortTypePanel({
  port, onPick, onClose,
}: {
  port: CatanPortDef;
  onPick: (type: PortType) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[s.correctionOverlay, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <View style={s.correctionHeader}>
        <Text style={[s.correctionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          What does this harbour trade?
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <Text style={[s.correctionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>
        HARBOUR TYPE
      </Text>
      <View style={s.correctionResourceRow}>
        {PORT_TYPE_ORDER.map(pt => (
          <TouchableOpacity
            key={pt}
            style={[
              s.resourceBtn,
              {
                backgroundColor: port.type === pt ? colors.primary : colors.muted,
                borderColor: port.type === pt ? colors.primary : colors.border,
              },
            ]}
            onPress={() => onPick(pt)}
          >
            <Text style={[s.resourceBtnText, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
              {pt === 'generic' ? '3:1' : pt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[s.correctionHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
        The box holds four 3:1 harbours and one of each resource, so naming
        this one swaps it with whichever harbour held that type.
      </Text>
    </View>
  );
}

/** Correct one hex: its resource and, unless it is the desert, its number. */
export function HexCorrectionPanel({
  hexLabel, resource, number, incomplete, onResource, onNumber, onDone, onClose,
}: {
  hexLabel: string;
  resource: ResourceType | null;
  number: number | null;
  /** A productive hex with no number yet; Done stays disabled. */
  incomplete: boolean;
  onResource: (r: ResourceType) => void;
  onNumber: (n: number) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[s.correctionOverlay, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <View style={s.correctionHeader}>
        <Text style={[s.correctionTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
          Correct Hex {hexLabel}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <Text style={[s.correctionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>RESOURCE</Text>
      <View style={s.correctionResourceRow}>
        {RESOURCES.map(r => (
          <TouchableOpacity
            key={r}
            style={[
              s.resourceBtn,
              {
                backgroundColor: resource === r ? RESOURCE_COLORS[r] : colors.muted,
                borderColor: resource === r ? RESOURCE_COLORS[r] : colors.border,
              },
            ]}
            onPress={() => onResource(r)}
          >
            <Text style={[
              s.resourceBtnText,
              { color: resource === r ? '#FFFFFF' : colors.mutedForeground, fontFamily: 'Inter_600SemiBold' },
            ]}>
              {RESOURCE_LABELS[r]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {resource !== 'desert' && (
        <>
          <Text style={[s.correctionLabel, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>NUMBER TOKEN</Text>
          <View style={s.correctionNumRow}>
            {CATAN_NUMBERS.map(n => (
              <TouchableOpacity
                key={n}
                style={[
                  s.numBtn,
                  {
                    backgroundColor: number === n ? colors.primary : colors.muted,
                    borderColor: number === n ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => onNumber(n)}
              >
                <Text style={[
                  s.numBtnText,
                  {
                    color: number === n ? colors.primaryForeground
                      : (n === 6 || n === 8) ? '#CC0000' : colors.foreground,
                    fontFamily: 'Inter_700Bold',
                  },
                ]}>
                  {n}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {incomplete && (
        <Text style={[s.correctionHint, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          Pick a number token — only the desert goes without one.
        </Text>
      )}

      <TouchableOpacity
        style={[s.confirmBtn, { backgroundColor: colors.primary, opacity: incomplete ? 0.4 : 1 }]}
        onPress={onDone}
        disabled={incomplete}
      >
        <Text style={[s.confirmBtnText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>
          Done
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export function SaveLayoutModal({
  name, onChangeName, saving, onCancel, onSave,
}: {
  name: string;
  onChangeName: (name: string) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[s.modal, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <Text style={[s.modalTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Save Board Layout</Text>
      <TextInput
        style={[s.modalInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
        value={name}
        onChangeText={onChangeName}
        placeholder="Board name (e.g. Tuesday Game)"
        placeholderTextColor={colors.mutedForeground}
        maxLength={40}
        autoFocus
        returnKeyType="done"
      />
      <View style={s.modalActions}>
        <TouchableOpacity style={[s.modalCancel, { borderColor: colors.border }]} onPress={onCancel}>
          <Text style={[s.modalCancelText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.modalConfirm, { backgroundColor: saving ? colors.muted : colors.primary }]}
          onPress={onSave}
          disabled={saving}
        >
          <Text style={[s.modalConfirmText, { color: colors.primaryForeground, fontFamily: 'Inter_700Bold' }]}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function LoadLayoutModal({
  layouts, onLoad, onDelete, onClose,
}: {
  layouts: readonly CatanBoardLayout[];
  onLoad: (layout: CatanBoardLayout) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <View style={[s.modal, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <Text style={[s.modalTitle, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>Saved Boards</Text>
      <ScrollView style={{ maxHeight: 280 }}>
        {layouts.map(layout => (
          <View key={layout.id} style={[s.layoutRow, { borderColor: colors.border }]}>
            <TouchableOpacity style={s.layoutRowMain} onPress={() => onLoad(layout)}>
              <Text style={[s.layoutName, { color: colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>{layout.name}</Text>
              <Text style={[s.layoutDate, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
                {formatSavedDate(layout.savedAt)}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onDelete(layout.id)} hitSlop={8}>
              <Ionicons name="trash-outline" size={18} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
      <TouchableOpacity style={[s.modalCancel, { borderColor: colors.border, marginTop: 12 }]} onPress={onClose}>
        <Text style={[s.modalCancelText, { color: colors.mutedForeground, fontFamily: 'Inter_500Medium' }]}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

export function EntryCard({
  icon, title, desc, onPress, accent = false,
}: {
  icon: string;
  title: string;
  desc: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[s.entryCard, { backgroundColor: colors.card, borderColor: accent ? colors.primary : colors.border }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[s.entryCardIcon, { backgroundColor: accent ? colors.primary + '20' : colors.muted }]}>
        <Ionicons name={icon as any} size={26} color={accent ? colors.primary : colors.mutedForeground} />
      </View>
      <View style={s.entryCardText}>
        <Text style={[s.entryCardTitle, { color: accent ? colors.primary : colors.foreground, fontFamily: 'Inter_600SemiBold' }]}>
          {title}
        </Text>
        <Text style={[s.entryCardDesc, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {desc}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={accent ? colors.primary : colors.mutedForeground} />
    </TouchableOpacity>
  );
}
