use serde_json::{json, to_string, Value};
use std::cmp::min;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

const MAX_COMPLEXITY: u32 = 10_000_000;

#[wasm_bindgen]
pub fn process_many_utxo_balances(
    json_input: &str,
    block_start: u32,
    block_end: u32,
) -> Result<JsValue, JsValue> {
    let mut dunes: HashMap<String, u32> = HashMap::new();

    // Parse the input JSON string
    let parsed =
        serde_json::from_str::<Value>(json_input).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let utxos = parsed
        .as_array()
        .ok_or_else(|| JsValue::from_str("Invalid utxo array passed"))?;

    // Create dunes map
    let mut total_dunes = 0;
    for (index, utxo) in utxos.iter().enumerate() {
        let dune_protocol_id = utxo
            .get("dune")
            .and_then(|dune| dune.get("dune_protocol_id"))
            .and_then(|a| a.as_str())
            .ok_or_else(|| {
                JsValue::from_str(&format!("Invalid dune_protocol_id at utxo #{}", index))
            })?;

        if dunes.contains_key(&dune_protocol_id.to_string()) {
            continue;
        }
        dunes.insert(dune_protocol_id.to_string(), total_dunes);
        total_dunes += 1;
    }

    let block_range: u32 = block_end - block_start;

    if block_range * total_dunes > MAX_COMPLEXITY {
        return Err(JsValue::from_str("The range and balance size is too large"));
    }

    let mut balances: Vec<Vec<u128>> = vec![vec![0; total_dunes as usize]; block_range as usize];

    for (index, utxo) in utxos.iter().enumerate() {
        let balance = utxo
            .get("balance")
            .and_then(|b| b.as_str())
            .ok_or_else(|| JsValue::from_str(&format!("Invalid balance at utxo #{}", index)))?
            .parse::<u128>()
            .map_err(|_| {
                JsValue::from_str(&format!("Invalid balance format at utxo #{}", index))
            })?;

        let dune_protocol_id = utxo
            .get("dune")
            .and_then(|dune| dune.get("dune_protocol_id"))
            .and_then(|a| a.as_str())
            .ok_or_else(|| {
                JsValue::from_str(&format!("Invalid dune_protocol_id at utxo #{}", index))
            })?;

        let balance_id = dunes
            .get(&dune_protocol_id.to_string())
            .ok_or_else(|| {
                JsValue::from_str(&format!("Invalid dune_protocol_id at utxo #{}", index))
            })?
            .clone() as usize;

        let block = utxo
            .get("utxo")
            .and_then(|utxo| utxo.get("block"))
            .and_then(|b| b.as_u64())
            .ok_or_else(|| JsValue::from_str(&format!("Invalid block at utxo #{}", index)))?
            .to_string()
            .parse::<u32>()
            .map_err(|_| JsValue::from_str(&format!("Invalid block format at utxo #{}", index)))?;

        let block_spent = utxo
            .get("utxo")
            .and_then(|utxo| utxo.get("block_spent"))
            .and_then(|b| Some(b.as_u64().unwrap_or(block_end as u64)))
            .ok_or_else(|| JsValue::from_str(&format!("Invalid block_spent at utxo #{}", index)))?
            .to_string()
            .parse::<u32>()
            .map_err(|_| {
                JsValue::from_str(&format!("Invalid block_spent format at utxo #{}", index))
            })?;

        if ((block - block_start) as usize) >= balances.len() || balance_id >= balances[0].len() {
            return Err(JsValue::from_str(&format!(
                "Index out of bounds at utxo #{}",
                index
            )));
        }

        // Validate the range before processing
        for current_block in block..min(block_spent, block_end) {
            let block_index = (current_block - block_start) as usize;

            if block_index >= balances.len() {
                return Err(JsValue::from_str(&format!(
                    "block_index out of bounds at utxo #{}, #{}",
                    block_index,
                    balances.len()
                )));
            }
            if balance_id >= balances[0].len() {
                return Err(JsValue::from_str(&format!(
                    "balance_id out of bounds at utxo #{}",
                    index
                )));
            }

            balances[block_index][balance_id] += balance;
        }
    }

    let address = match utxos[0]
        .get("utxo")
        .and_then(|a| a.get("address"))
        .and_then(|a| a.get("address"))
        .and_then(|a| a.as_str())
    {
        Some(address) => address,
        None => {
            return Err(JsValue::from_str(&format!(
                "No address field in utxo array {:?}",
                utxos[0]
            )));
        }
    };

    let mut result: Value = json!({
        "address": address,
        "balances": {}
    });

    if let Value::Object(ref mut balances_map) = result["balances"] {
        for (current_block_index, dunes_in_block) in balances.iter().enumerate() {
            let block_num = (current_block_index as u32) + block_start;

            let mut block_balances: HashMap<String, String> = HashMap::new();
            for (dune_protocol_id, dune_map_index) in dunes.iter() {
                block_balances.insert(
                    dune_protocol_id.clone(),
                    dunes_in_block[*dune_map_index as usize].to_string(),
                );
            }

            balances_map.insert(block_num.to_string(), json!(block_balances));
        }
    }

    Ok(JsValue::from_str(&to_string(&result).unwrap()))
}
