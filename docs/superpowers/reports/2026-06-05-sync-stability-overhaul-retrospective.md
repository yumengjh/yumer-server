# 鏁版嵁鍚屾閾捐矾绋冲畾鎬ч噸鏁村鐩?
> 鏃ユ湡锛?026-06-05
> 鍓嶇锛歚F:\yuediter`
> 鍚庣锛歚F:\yumer-server`
> 鐘舵€侊細绗竴鐗堢ǔ瀹氭€?MVP 瀹屾垚

## 1. 鑳屾櫙涓庝簨鏁呭満鏅?
瑙﹀彂鏈閲嶆暣鐨勫疄闄呭満鏅槸锛?
1. 涓€娆℃€ф彃鍏ュぇ閲忓潡锛?2. 棣栨壒鍚屾浠嶅湪杩涜鏃讹紝绔嬪嵆鍏ㄩ儴鍒犻櫎锛?3. 闅忓悗鎻掑叆鏂板唴瀹癸紱
4. 绛夊緟鍚屾瀹屾垚骞跺埛鏂帮紱
5. 鍒锋柊鍚庢枃妗ｄ负绌恒€?
鏍瑰洜涓嶆槸鍗曚竴鍑芥暟閿欒锛岃€屾槸鍓嶇蹇収銆乨irty 闃熷垪銆乮nflight ACK銆佹湇鍔＄鑽夌鐗堟湰鍜屾墜鍔ㄦ彁浜や箣闂寸己灏戠粺涓€杈圭晫銆傛棫瀹炵幇浼氬湪涔卞簭銆侀儴鍒嗗け璐ャ€佺┖ ACK 鎴?create/delete 浜ら敊鏃讹紝閿欒娓呯悊浠嶉渶鍚屾鐨勬暟鎹€?
## 2. MVP 绋冲畾鎬х洰鏍?
鏈疆纭畾鐨勭涓€鐗堢洰鏍囷細

- 鍗曟椿璺冩枃妗ｅ悓姝ヤ細璇濓紱
- 楂橀 create/delete/recreate 涓嶉潤榛樹涪鏁版嵁锛?- 鍚屼竴鏃跺埢鍙淳鍙戜竴涓悓姝ユ壒娆★紱
- 缃戠粶閲嶆斁涓嶄細閲嶅鎵ц鍐欐搷浣滐紱
- stale/expired session 涓嶅厑璁哥户缁啓锛?- 鎵嬪姩淇濆瓨蹇呴』鍦ㄦ渶鏂版湰鍦版搷浣滆鏈嶅姟绔‘璁ゅ悗鎵嶈兘 commit锛?- 鏈嶅姟绔?ACK 蹇呴』鍙獙璇侊紝绌?ACK 涓嶅緱琚綋浣滄垚鍔燂紱
- 涓烘湭鏉ュ浜哄崗浣滀繚鐣?`sessionId / sessionEpoch / opSeq` 鍗忚鎵╁睍浣嶃€?
## 3. 鏍稿績璁捐鍐崇瓥

### 3.1 鏂囨。閿佷紭鍏?
鍚庣鍐欏叆缁熶竴鍏堥攣 Document锛屽啀澶勭悊 Block锛岄伩鍏嶅崟鍧楀啓涓?batch 鍐欎娇鐢ㄧ浉鍙嶉攣椤哄簭銆傛枃妗?`head` 鍜岃崏绋夸慨璁㈠彿鍦ㄤ簨鍔″唴鎺ㄨ繘銆?
### 3.2 鎵规骞傜瓑鍥炴墽

鏂板 `sync_batch_receipts`锛?
- 鍞竴閿細`docId + clientBatchId`
- 淇濆瓨璇锋眰鎸囩汗鍜岄娆″搷搴?- 鍚?key 鍚岃姹傜洿鎺ュ洖鏀?- 鍚?key 涓嶅悓璇锋眰杩斿洖 `CLIENT_BATCH_ID_REUSED`

璇锋眰鎸囩汗鍖呭惈鐗堟湰銆乻ession銆丄CK 娓告爣涓庢搷浣滃唴瀹癸紝閬垮厤鐩稿悓 batch ID 琚笉鍚岃姹傚鐢ㄣ€?
### 3.3 鍗曟椿璺冧細璇濈绾?
鏂板 `document_sync_sessions`锛?
- `sessionId`
- `sessionEpoch`
- `holderUserId`
- `leaseExpiresAt`
- `lastAckedOpSeq`

缂栬緫鍐呭鍔犺浇浼氳幏鍙?缁浼氳瘽锛沚atch銆乧ommit銆乨iscard 閮芥牎楠屽綋鍓嶄細璇濄€傚墠绔瘡涓ゅ垎閽熺画绉燂紝澶辨晥鍚庤繘鍏?`lease-lost`锛屼笉浼氱户缁嚜鍔ㄥ啓鍏ャ€?
### 3.4 鏄惧紡 ACK 娓告爣

鍓嶇姣忔鏈湴鍙樻洿鍒嗛厤鍗曡皟閫掑 revision锛屾壒娆″彂閫?`ackedThroughOpSeq`銆傚悗绔粎鍦ㄦ暣鎵规垚鍔熷悗鎺ㄨ繘浼氳瘽 ACK 楂樻按浣嶏紝骞跺湪鍝嶅簲涓庡箓绛夊洖鎵т腑杩斿洖璇ユ父鏍囥€?
commit 涓嶅啀淇′换瀹㈡埛绔嚜琛屽０绉扮殑娓告爣锛涘鏋滄彁浜ょ洰鏍囪秴杩囨湇鍔＄宸茬‘璁ら珮姘翠綅锛岃繑鍥?`SYNC_SESSION_ACK_NOT_REACHED`銆?
### 3.5 鎵嬪姩淇濆瓨鎻愪氦灞忛殰

鎵嬪姩淇濆瓨娴佺▼璋冩暣涓猴細

1. 鏆傚仠 autosync 娲惧彂锛?2. 鎹曡幏缂栬緫鍣ㄦ渶鏂板唴瀹癸紱
3. flush 鍒?dirty 闃熷垪娓呯┖锛?4. 纭鏃?conflict/error/lease-lost锛?5. 鎼哄甫 session 鍜?ACK 娓告爣 commit锛?6. 鏇存柊鍓嶇鐗堟湰杈圭晫锛?7. 鎭㈠ autosync銆?
## 4. 宸蹭慨澶嶉棶棰樻槧灏?
| 鍘熷璁￠」 | 澶勭悊缁撴灉 |
|---|---|
| C1 Document head 骞跺彂涓㈠け | 鍐欒矾寰勫鍔犳枃妗ｉ攣锛屼簨鍔″唴鎺ㄨ繘鐗堟湰 |
| C2/M2 閿侀『搴忎笉涓€鑷?| 缁熶竴 Document-first |
| C3 delete+update 澶嶆椿鍒犻櫎 | delete 鎴愪负 update/move 鐨勭粓鎬?|
| H1 batch 鏃犲箓绛?| 鎸佷箙鍖栨壒娆″洖鎵т笌璇锋眰鎸囩汗 |
| H2 閮ㄥ垎澶辫触鎺ㄨ繘 head | 鏈夊け璐ヤ笉鎺ㄨ繘姝ｅ紡 head |
| H3 32 浣?hash 纰版挒 | 鏀逛负 SHA-256 |
| H4 绌?results 褰撴垚鍔?| 闈炲啿绐佺┖ ACK 鍒や负鍗忚閿欒锛屼繚鐣?dirty |
| H5 澶氳妭鐐瑰垵濮嬪唴瀹逛笉 create | 绉婚櫎鍗曡妭鐐归檺鍒?|
| H6 flush/commit 绔炴€?| autosync 鏆傚仠 + commit barrier |
| H7 閬楃暀璺緞缁曡繃鍐茬獊 | JSON 缂栬緫涓婚摼璺彧浣跨敤鍚屾寮曟搸锛沴egacy 浠呬繚鐣?HTML fallback |
| M1 baseVersion 鍙€?| 涓诲悓姝ュ叆鍙ｅ己鍒惰姹?|
| M3 绌?discard 鎺ㄨ繘 revision | 鏃犺崏绋夸笉鍐嶆帹杩?|
| M5 create 骞傜瓑鏌ラ噸鍏ㄩ噺鎵弿 | 鏀逛负 JSON attrs 瀹氬悜鏌ヨ |
| M6 閮ㄥ垎澶辫触鍚庣増鏈噸璇?| 鍓嶇浣跨敤鏈嶅姟绔繑鍥炵殑鏂?revision锛屽け璐ラ」淇濇寔 dirty |
| M7 ACK 鍥炲～寮傚父瀵艰嚧閲嶅鍐?| 鍥炲～ UI 寮傚父鍙褰曟棩蹇楋紝涓嶆妸宸叉垚鍔熸湇鍔＄鎵规鍒ゅけ璐?|
| L2 宓屽 ACK 涓嶅洖濉?| ACK 閫掑綊閬嶅巻鏁存５鏂囨。鏍?|
| L3 鍐椾綑鍚屾鍏冩暟鎹?| create/update ACK 鍚庢竻鐞嗕复鏃跺悓姝ュ睘鎬?|
| L6 鐗堟湰鍙峰叏閲忔壂鎻?| 鏀逛负 SQL `MAX(ver)` |
| L7 DTO 鏍￠獙涓嶈冻 | 澧炲姞闈炵┖瀛楃涓蹭笌闈炵┖ operations 鏍￠獙 |
| L8 commit/discard 铏氬 viewCount | 鏀圭敤鏃犲壇浣滅敤璁块棶鏍￠獙 |

### M4 璇存槑

鑽夌鍒犻櫎鏃?`Block.isDeleted=false`銆佹渶鏂拌崏绋跨増鏈甫 `attrs.deleted=true` 鏄綋鍓嶁€滆崏绋夸笉姹℃煋姝ｅ紡 head鈥濈殑琛ㄨ揪鏂瑰紡锛屼笉搴旂洿鎺ユ妸 Block 杞垹闄ゃ€傝椤逛綔涓鸿崏绋挎ā鍨嬬害鏉熶繚鐣欙紝骞剁敱 commit/discard 鍐冲畾鏈€缁堢姸鎬併€?
## 5. 鐢ㄦ埛浜嬫晠鍦烘櫙濡備綍琚樆鏂?
瀵逛簬鈥滃ぇ閲忔彃鍏?鈫?鍚屾涓叏閮ㄥ垹闄?鈫?鍐嶆彃鍏?鈫?鍒锋柊鈥濓細

- create inflight 鏃跺彂鐢?delete锛屼細杞崲涓?create ACK 鍚庣殑 follow-up delete锛?- 琚垹闄ょ殑鏃ф湇鍔＄鍧椾繚鎸?delete dirty锛屼笉浼氳鍚庣画 update/move 澶嶆椿锛?- 鏂颁竴娉?create 浣跨敤鐙珛 clientId 鍜岀ǔ瀹?`syncCreateId`锛?- 鏃?ACK 鍙竻鐞嗗叾娲惧彂鏃跺搴旂殑 revision锛屼笉浼氭竻鐞?inflight 鏈熼棿浜х敓鐨勬柊鎿嶄綔锛?- 鏈嶅姟绔壒娆″彲瀹夊叏閲嶆斁锛?- 闈炵┖鎵规娌℃湁纭畾 ACK 鏃跺墠绔笉浼氭竻 dirty锛?- 鏈湴蹇収缁х画浣滀负娴忚鍣ㄥ紓甯搁€€鍑哄悗鐨勬仮澶嶄繚鎶ゅ眰銆?
瀵瑰簲鍥炲綊瑕嗙洊浣嶄簬锛?
- `src/services/sync/__tests__/snapshot.test.ts`
- `src/services/sync/__tests__/reducer.test.ts`
- `src/services/sync/__tests__/engine-order.test.ts`
- 鍚庣 `blocks-sync-idempotency.spec.ts`
- 鍚庣 `blocks.service.draft.spec.ts`

## 6. 鏁版嵁搴撳彉鏇?
蹇呴』鎵ц浠ヤ笅杩佺Щ锛?
1. `1782500000000-CreateSyncBatchReceipts.ts`
2. `1782600000000-CreateDocumentSyncSessions.ts`
3. `1782700000000-AddAckedThroughOpSeqToSyncBatchReceipts.ts`

绗笁涓縼绉荤敤浜庡吋瀹瑰凡缁忔彁鍓嶅垱寤鸿繃鍥炴墽琛ㄧ殑鐜銆?
## 7. 楠岃瘉缁撴灉

### 鍚庣

- 鍏ㄩ噺 Jest锛歚36 suites / 187 tests` 鍏ㄩ儴閫氳繃
- `pnpm build` 閫氳繃

### 鍓嶇鍚屾鐩稿叧

- 鍚屾涓庝細璇濆畾鍚戦泦鍚堬細`8 files / 56 tests` 鍏ㄩ儴閫氳繃
- `pnpm build` 閫氳繃

### 鍓嶇鍏ㄩ噺娴嬭瘯鐜扮姸

- `82 files / 318 tests` 閫氳繃
- 浠嶆湁 3 涓笌鍚屾鏀归€犳棤鍏崇殑鏃㈡湁 source-contract 澶辫触锛屼互鍙?1 涓祴璇曞浠剁己灏?`@tiptap/extension-document` 渚濊禆
- 澶辫触闆嗕腑鍦?`TaskItemView.source.test.ts`銆乣CodeBlockView.source.test.ts`銆乣imageBlock.test.ts`

杩欎簺澶辫触涓嶈Е鍙婂悓姝ヤ唬鐮侊紱鏋勫缓涓庡悓姝ョ浉鍏冲洖褰掑潎閫氳繃銆?
## 8. 绗竴鐗?MVP 宸茬煡杈圭晫

1. 褰撳墠鏄枃妗ｇ骇鍗曟椿璺?session锛屼笉鏄?CRDT/OT 澶氫汉鍗忎綔銆?2. 鍚屼竴鐢ㄦ埛澶氫釜鏍囩椤电洰鍓嶅彲鑳藉鐢ㄥ悓涓€鏈繃鏈?session锛涙湭鏉ュ浜哄崗浣滈樁娈靛簲寮曞叆鏄惧紡 `clientInstanceId`銆?3. 娴忚鍣ㄥ湪鏈?ACK 鏃跺穿婧冿紝鎭㈠渚濊禆鐜版湁鏈湴蹇収淇濇姢锛涘皻鏈疄鐜版寔涔呭寲閫愭搷浣滆处鏈嚜鍔ㄩ噸鏀俱€?4. 灏氭湭鍔犲叆鐪熷疄 PostgreSQL 澶氳繛鎺ュ帇鍔涙祴璇曪紱褰撳墠骞跺彂绾︽潫鐢变簨鍔°€佽閿佸拰鍗曞厓/鏈嶅姟娴嬭瘯瑕嗙洊銆?5. legacy HTML 淇濆瓨浠嶄綔涓烘樉寮?fallback 瀛樺湪锛屼絾 TipTap JSON 涓荤紪杈戦摼璺笉浼氬洖閫€鍒?legacy銆?
## 9. 鍚庣画澶氫汉鍗忎綔婕旇繘寤鸿

鍦ㄥ綋鍓嶅崗璁笂缁х画婕旇繘鏃讹細

1. 灏?`holderUserId` 鎵╁睍涓?`clientInstanceId + actorId`锛?2. 浼氳瘽琛ㄤ粠鏂囨。鍞竴鏀逛负鏂囨。涓嬪鍙備笌鑰咃紱
3. 淇濈暀鐜版湁 `clientBatchId / sessionEpoch / ackedThroughOpSeq`锛?4. 鎿嶄綔浠庡帇缂╁悗鐨勫潡鐘舵€佸崌绾т负鍙氦鎹㈢殑 OT/CRDT operation锛?5. ACK 娓告爣鏀逛负姣忓弬涓庤€呯嫭绔嬫父鏍囷紱
6. 澧炲姞 WebSocket 鎺ㄩ€侊紝浣嗕粛淇濈暀 HTTP 骞傜瓑鍥炴墽浣滀负鎭㈠閫氶亾銆?
## 10. 缁撹

鏈疆娌℃湁缁х画渚濊禆闆舵暎琛ヤ竵锛岃€屾槸鎶婃渶鍗遍櫓鐨勫悓姝ヨ竟鐣岀粺涓€鍒帮細

**Document-first 浜嬪姟閿?+ 骞傜瓑鎵规鍥炴墽 + 娲昏穬浼氳瘽绉熺害 + 鏄惧紡 ACK 娓告爣 + 鎵嬪姩鎻愪氦灞忛殰銆?*

绗竴鐗堢ǔ瀹氭€?MVP 宸茶兘瑕嗙洊褰撳墠鎶ュ憡涓殑涓昏楂樺嵄闂鍜岀敤鎴峰疄闄呭鐜板満鏅紝骞朵负鍚庣画澶氫汉鍗忎綔淇濈暀浜嗗崗璁紨杩涚┖闂淬€?
