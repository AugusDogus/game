using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class PlayerMovement : MonoBehaviour
{

    public float moveSpeed = 5f;
    public Rigidbody2D rb;
    public Animator animator;
    Vector2 movement;
    bool sprinting;

    void Update()
    {

        Debug.Log(this.animator.GetCurrentAnimatorStateInfo(0).IsName("Movement"));

        // Input
        movement.x = Input.GetAxisRaw("Horizontal");
        movement.y = Input.GetAxisRaw("Vertical");
        movement = movement.normalized;

        sprinting = Input.GetButton("Fire3");

        if (movement != Vector2.zero)
        {
            animator.SetFloat("Horizontal", movement.x);
            animator.SetFloat("Vertical", movement.y);
        } else {
            if (animator.GetFloat("Vertical") != 0)
            {
                animator.SetFloat("Horizontal", 0);
            }
        }

        animator.SetFloat("Speed", movement.sqrMagnitude);
    }

    void FixedUpdate()
    {
        if (sprinting)
        {
            moveSpeed = 7f;
        } else
        {
            moveSpeed = 5f;
        }

        rb.MovePosition(rb.position + movement * moveSpeed * Time.fixedDeltaTime);
    }
}
