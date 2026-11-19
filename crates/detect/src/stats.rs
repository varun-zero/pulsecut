//! Small statistical helpers. Kept dependency-free and tested.

/// Median of a mutable slice (the slice is shuffled in place by selection).
pub fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

/// Median absolute deviation, the robust cousin of standard deviation.
/// A spike 4 MADs away is a real event; 4 standard deviations often is not,
/// because the spike itself inflates the standard deviation.
pub fn mad(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let m = median(values);
    let deviations: Vec<f64> = values.iter().map(|x| (x - m).abs()).collect();
    median(&deviations) * 1.4826 // make it a consistent estimator of sigma
}

pub fn clamp01(x: f64) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    x.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_odd_even() {
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&[4.0, 1.0, 3.0, 2.0]), 2.5);
    }

    #[test]
    fn mad_ignores_outlier() {
        // 20 quiet seconds + one huge spike: MAD should stay near zero.
        let mut v = vec![2.0; 20];
        v.push(400.0);
        assert!(mad(&v) < 0.001, "MAD was {}", mad(&v));
    }

    #[test]
    fn clamp_handles_nan() {
        assert_eq!(clamp01(f64::NAN), 0.0);
        assert_eq!(clamp01(2.0), 1.0);
    }
}
